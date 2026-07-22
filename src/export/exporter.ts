import type { CollectorContext } from '../context.js';
import type { ExportPayload, Summary } from '../types.js';

export class Exporter {
  constructor(
    private readonly ctx: CollectorContext,
    private readonly startTime: number,
    private readonly getSummary: () => Summary,
    private readonly getEndpoints: () => unknown,
    private readonly getJsonResponses: () => unknown,
    private readonly getWebSockets: () => unknown,
  ) {}

  buildPayload(): ExportPayload {
    // Bug fix: this used to hard-truncate to tail(100)/tail(20) here, *on top of*
    // the caps already enforced by BoundedList/BoundedStore upstream (maxRequests,
    // maxEvents) — so a session with 345 requests in memory only ever exported the
    // last 100. toArray() exports everything actually held in memory; the real
    // ceiling already lives in the config, not in a second hardcoded number here.
    const events: ExportPayload['events'] = {};
    for (const [type, list] of this.ctx.events.entries()) {
      events[type] = list.toArray();
    }

    const summary = this.getSummary(); // also runs ctx.pruneAll() — do this before reading ctx.* directly below

    return {
      meta: {
        exportTime: new Date().toISOString(),
        url: window.location.href,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        version: '4.0-ts',
        uptime: Date.now() - this.startTime,
      },
      summary,
      endpoints: this.getEndpoints(),
      jsonData: this.getJsonResponses(),
      websockets: this.getWebSockets(),
      events,
      errors: this.ctx.logger.getErrors(),
      networkRequests: this.ctx.networkRequests.toArray(),
      performanceData: this.ctx.performanceData.values(),
      localStorage: Object.fromEntries(this.ctx.localStorageMap),
      sessionStorage: Object.fromEntries(this.ctx.sessionStorageMap),
      cookies: Object.fromEntries(this.ctx.cookies),
      globalObjects: Object.fromEntries(this.ctx.globalObjects),
      beacons: this.ctx.beacons.toArray(),
      eventSources: this.ctx.eventSources.values(),
      dynamicResources: this.ctx.dynamicResources.toArray(),
      navigationHistory: this.ctx.navigationHistory.toArray(),
      noise: { excludedTotal: this.ctx.excludedTotal, byRule: Object.fromEntries(this.ctx.excludedStats) },
    };
  }

  exportAsJsonFile(): ExportPayload {
    const data = this.buildPayload();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `research_${window.location.hostname}_${Date.now()}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.ctx.logger.log('info', `✅ Data exported: ${filename}`);
    return data;
  }
}
