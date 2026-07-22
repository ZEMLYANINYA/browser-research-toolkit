import type { CollectorContext } from '../context.js';
import type { Monitor } from '../types.js';

export class PerformanceMonitor implements Monitor {
  private observer: PerformanceObserver | null = null;

  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    if (!window.performance || !performance.getEntriesByType) {
      this.ctx.logger.log('warn', 'Performance API not available');
      return;
    }

    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!this.ctx.isApiEndpoint(entry.name)) continue;
          this.ctx.performanceData.set(entry.name, {
            name: entry.name,
            duration: entry.duration,
            startTime: entry.startTime,
            type: entry.entryType,
            timestamp: Date.now(),
          });
          this.ctx.logger.log('debug', `⚡ Performance: ${entry.name} - ${entry.duration.toFixed(2)}ms`);
        }
      });
      this.observer.observe({ entryTypes: ['resource', 'navigation', 'measure'] });
    } catch (error) {
      this.ctx.logger.log('warn', 'PerformanceObserver setup failed', error);
    }
  }

  /** One-off scan of resources already loaded before the collector attached. */
  analyzeExistingRequests(): void {
    if (!window.performance || !performance.getEntriesByType) return;

    try {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      let found = 0;

      for (const entry of entries) {
        if (!this.ctx.isApiEndpoint(entry.name)) continue;
        found++;
        this.ctx.performanceData.set(entry.name, {
          name: entry.name,
          duration: entry.duration,
          initiatorType: entry.initiatorType,
          transferSize: entry.transferSize,
          timestamp: Date.now(),
        });
      }

      if (found > 0) {
        this.ctx.logger.log('info', `🔍 Found ${found} API endpoints in performance history`);
      }
    } catch (error) {
      this.ctx.logger.log('warn', 'Existing requests analysis failed', error);
    }
  }

  teardown(): void {
    this.observer?.disconnect();
  }
}
