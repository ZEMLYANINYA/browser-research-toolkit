import type { CollectorContext } from '../context.js';
import type { Monitor } from '../types.js';

export class StorageMonitor implements Monitor {
  private originalSetItem: typeof Storage.prototype.setItem | null = null;

  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    this.captureSnapshot();
    this.patchSetItem();
    this.captureCookies();
  }

  teardown(): void {
    if (this.originalSetItem) Storage.prototype.setItem = this.originalSetItem;
  }

  private captureSnapshot(): void {
    try {
      this.snapshotInto(window.localStorage, this.ctx.localStorageMap);
      this.snapshotInto(window.sessionStorage, this.ctx.sessionStorageMap);
    } catch (error) {
      this.ctx.logger.log('warn', 'Storage snapshot failed', error);
    }
  }

  private snapshotInto(storage: Storage, target: Map<string, { value: unknown; timestamp: number; size?: number }>): void {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)!;
      const value = storage.getItem(key) ?? '';
      target.set(key, {
        value: this.ctx.sanitizer.sanitizeStorageValue(value, key),
        timestamp: Date.now(),
        size: new Blob([value]).size,
      });
    }
  }

  private patchSetItem(): void {
    this.originalSetItem = Storage.prototype.setItem;
    const original = this.originalSetItem;
    const ctx = this.ctx;

    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (!ctx.isActive) return original.call(this, key, value);

      const isLocal = this === window.localStorage;
      const label = isLocal ? 'localStorage' : 'sessionStorage';
      const target = isLocal ? ctx.localStorageMap : ctx.sessionStorageMap;

      target.set(key, {
        value: ctx.sanitizer.sanitizeStorageValue(value, key),
        timestamp: Date.now(),
        size: new Blob([value]).size,
      });
      ctx.logger.logDiscovery(`💾 ${label.toUpperCase()}`, `SET ${key}`, { key, valueBytes: new Blob([value]).size });

      if (target.size > ctx.config.maxStorageItems) {
        const oldestKey = target.keys().next().value;
        if (oldestKey !== undefined) target.delete(oldestKey);
      }

      return original.call(this, key, value);
    };
  }

  private captureCookies(): void {
    try {
      for (const cookie of document.cookie.split(';')) {
        const eqPos = cookie.indexOf('=');
        if (eqPos === -1) continue;
        const name = cookie.slice(0, eqPos).trim();
        const value = cookie.slice(eqPos + 1).trim();
        if (name && !this.ctx.sanitizer.containsSensitiveData(name)) {
          this.ctx.cookies.set(name, {
            value: this.ctx.sanitizer.sanitizeStorageValue(value, name),
            timestamp: Date.now(),
          });
        }
      }
    } catch (error) {
      this.ctx.logger.log('debug', 'Cookie monitoring failed', error);
    }
  }
}
