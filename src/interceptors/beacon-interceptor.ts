import type { CollectorContext } from '../context.js';
import type { Interceptor } from '../types.js';

export class BeaconInterceptor implements Interceptor {
  private original: typeof navigator.sendBeacon | null = null;

  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    // Bug fix: `navigator` itself doesn't exist as a global before Node 21 (added
    // there, not backported to the 20.x LTS line) — this bare reference is exactly
    // what crashed the Node 20.x CI matrix job while 22.x passed. Always present in
    // a real browser; only Node's own test runtime needs the guard.
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    this.original = navigator.sendBeacon.bind(navigator);
    const original = this.original;
    const ctx = this.ctx;

    navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
      if (ctx.isActive) {
        const size =
          data instanceof Blob ? data.size : typeof data === 'string' ? data.length : ('unknown' as const);
        const record = { url: ctx.sanitizer.sanitizeUrl(String(url)), dataSize: size, timestamp: Date.now() };
        ctx.beacons.push(record);
        ctx.logger.logDiscovery('📡 BEACON', String(url), { ...record, type: 'beacon' });
      }
      return original(url, data);
    }) as typeof navigator.sendBeacon;
  }

  restore(): void {
    if (this.original && typeof navigator !== 'undefined') navigator.sendBeacon = this.original;
  }
}
