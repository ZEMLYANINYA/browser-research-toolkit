import type { CollectorContext } from '../context.js';
import type { Monitor } from '../types.js';

type WindowWithDynamicKeys = Window & Record<string, unknown>;

export class GlobalObjectMonitor implements Monitor {
  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    const win = window as unknown as WindowWithDynamicKeys;

    for (const name of this.ctx.config.globalObjectNames) {
      if (win[name] === undefined) continue;
      try {
        this.ctx.globalObjects.set(name, this.ctx.sanitizer.sanitizeObject(win[name]));
        this.ctx.logger.log('info', `🔍 Global object found: ${name}`);
      } catch (error) {
        this.ctx.logger.log('debug', `Failed to capture ${name}`, error);
      }
    }

    // Convention in a lot of frontends: window._something = config/state blob.
    for (const key of Object.keys(win)) {
      if (!key.startsWith('_') || typeof win[key] !== 'object') continue;
      try {
        this.ctx.globalObjects.set(key, this.ctx.sanitizer.sanitizeObject(win[key]));
      } catch {
        // inaccessible property (cross-origin, getter throws, etc.) — skip
      }
    }
  }
}
