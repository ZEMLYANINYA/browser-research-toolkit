import type { CollectorContext } from '../context.js';
import type { Monitor, NavigationType } from '../types.js';

/**
 * Google Maps (and every other SPA) changes URL/view without a real page
 * navigation — beforeunload never fires, so nothing else in this toolkit sees
 * it happen. Wraps history.pushState/replaceState and listens for
 * popstate/hashchange, all four of which cover how a modern SPA actually
 * navigates.
 */
export class NavigationMonitor implements Monitor {
  private originalPushState: History['pushState'] | null = null;
  private originalReplaceState: History['replaceState'] | null = null;

  private readonly onPopState = () => {
    if (!this.ctx.isActive) return;
    this.record('popstate', window.location.href, window.location.href);
  };

  private readonly onHashChange = (event: HashChangeEvent) => {
    if (!this.ctx.isActive) return;
    this.record('hashchange', event.oldURL, event.newURL);
  };

  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    this.originalPushState = history.pushState.bind(history);
    this.originalReplaceState = history.replaceState.bind(history);
    const originalPushState = this.originalPushState;
    const originalReplaceState = this.originalReplaceState;
    const ctx = this.ctx;
    const record = this.record.bind(this);

    history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
      const from = window.location.href;
      const result = originalPushState.apply(this, args);
      if (ctx.isActive) record('pushState', from, window.location.href);
      return result;
    };

    history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
      const from = window.location.href;
      const result = originalReplaceState.apply(this, args);
      if (ctx.isActive) record('replaceState', from, window.location.href);
      return result;
    };

    window.addEventListener('popstate', this.onPopState);
    window.addEventListener('hashchange', this.onHashChange);
  }

  private record(type: NavigationType, from: string, to: string): void {
    if (from === to) return; // replaceState with no actual URL change, etc.
    this.ctx.navigationHistory.push({ type, from, to, timestamp: Date.now() });
    this.ctx.logger.logDiscovery('🧭 NAVIGATION', `${type}: ${to}`, { type, from, to });
  }

  teardown(): void {
    if (this.originalPushState) history.pushState = this.originalPushState;
    if (this.originalReplaceState) history.replaceState = this.originalReplaceState;
    window.removeEventListener('popstate', this.onPopState);
    window.removeEventListener('hashchange', this.onHashChange);
  }
}
