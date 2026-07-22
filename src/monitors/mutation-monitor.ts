import type { CollectorContext } from '../context.js';
import type { Monitor } from '../types.js';

export class MutationMonitor implements Monitor {
  private observer: MutationObserver | null = null;

  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    if (!window.MutationObserver) return;
    const ctx = this.ctx;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName?.startsWith('data-')) {
          const node = mutation.target as Element;
          const key = mutation.attributeName;
          const value = node.getAttribute(key);
          if (value && ctx.config.keywords.some((kw) => key.toLowerCase().includes(kw))) {
            const truncated = ctx.sanitizer.truncate(value, 100);
            ctx.mutationDiscoveries.push({ attribute: key, value: truncated, timestamp: Date.now() });
            ctx.logger.logDiscovery('🔍 DATA ATTRIBUTE', `${key}=${truncated}`, { attribute: key, value: truncated });
          }
        }

        if (mutation.type === 'childList') {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node.nodeType !== 1) continue;
            const el = node as HTMLElement;
            for (const key of Object.keys(el.dataset ?? {})) {
              if (ctx.config.keywords.some((kw) => key.toLowerCase().includes(kw))) {
                const truncated = ctx.sanitizer.truncate(el.dataset[key] ?? '', 100);
                ctx.mutationDiscoveries.push({ attribute: key, value: truncated, timestamp: Date.now() });
                ctx.logger.logDiscovery('🔍 DATA ATTRIBUTE (new node)', `${key}=${truncated}`, {
                  attribute: key,
                  value: truncated,
                });
              }
            }
          }
        }
      }
    });

    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  teardown(): void {
    this.observer?.disconnect();
  }
}
