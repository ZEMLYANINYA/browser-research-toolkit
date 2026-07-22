import type { CollectorContext } from '../context.js';
import type { Interceptor } from '../types.js';

export class BeaconInterceptor implements Interceptor {
  private original: typeof navigator.sendBeacon | null = null;

  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    if (!navigator.sendBeacon) return;
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
    if (this.original) navigator.sendBeacon = this.original;
  }
}
