import type { CollectorContext } from '../context.js';
import type { Interceptor } from '../types.js';

export class DomResourceInterceptor implements Interceptor {
  private originalAppendChild: typeof Element.prototype.appendChild | null = null;
  private originalInsertBefore: typeof Element.prototype.insertBefore | null = null;

  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    this.originalAppendChild = Element.prototype.appendChild;
    this.originalInsertBefore = Element.prototype.insertBefore;
    const originalAppendChild = this.originalAppendChild;
    const originalInsertBefore = this.originalInsertBefore;
    const ctx = this.ctx;

    Element.prototype.appendChild = function <T extends Node>(this: Element, node: T): T {
      if (ctx.isActive) reportIfResource(node, 'appendChild');
      return originalAppendChild.call(this, node) as T;
    };

    Element.prototype.insertBefore = function <T extends Node>(this: Element, node: T, ref: Node | null): T {
      if (ctx.isActive) reportIfResource(node, 'insertBefore');
      return originalInsertBefore.call(this, node, ref) as T;
    };

    function reportIfResource(node: Node, method: string): void {
      const el = node as Element;
      if (el.tagName === 'SCRIPT' && (el as HTMLScriptElement).src) {
        const script = el as HTMLScriptElement;
        ctx.dynamicResources.push({ kind: 'script', url: script.src, method, timestamp: Date.now() });
        ctx.logger.logDiscovery('📜 DYNAMIC SCRIPT', script.src, {
          url: script.src,
          async: script.async,
          defer: script.defer,
          method,
          type: 'dynamic_script',
        });
      }
      if (el.tagName === 'LINK' && (el as HTMLLinkElement).rel === 'stylesheet') {
        const link = el as HTMLLinkElement;
        ctx.dynamicResources.push({ kind: 'css', url: link.href, method, timestamp: Date.now() });
        ctx.logger.logDiscovery('🎨 DYNAMIC CSS', link.href, { url: link.href, type: 'dynamic_css' });
      }
    }
  }

  restore(): void {
    if (this.originalAppendChild) Element.prototype.appendChild = this.originalAppendChild;
    if (this.originalInsertBefore) Element.prototype.insertBefore = this.originalInsertBefore;
  }
}
