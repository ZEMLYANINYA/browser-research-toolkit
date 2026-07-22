import { mergeConfig } from './config.js';
import { CollectorContext } from './context.js';
import { ResponseAnalyzer } from './analysis/response-analyzer.js';
import { Exporter } from './export/exporter.js';

import { FetchInterceptor } from './interceptors/fetch-interceptor.js';
import { XhrInterceptor } from './interceptors/xhr-interceptor.js';
import { WebSocketInterceptor } from './interceptors/websocket-interceptor.js';
import { BeaconInterceptor } from './interceptors/beacon-interceptor.js';
import { EventSourceInterceptor } from './interceptors/eventsource-interceptor.js';
import { DomResourceInterceptor } from './interceptors/dom-resource-interceptor.js';

import { EventMonitor } from './monitors/event-monitor.js';
import { ErrorMonitor } from './monitors/error-monitor.js';
import { StorageMonitor } from './monitors/storage-monitor.js';
import { PerformanceMonitor } from './monitors/performance-monitor.js';
import { GlobalObjectMonitor } from './monitors/global-object-monitor.js';
import { MutationMonitor } from './monitors/mutation-monitor.js';
import { NavigationMonitor } from './monitors/navigation-monitor.js';

import type { Interceptor, Monitor, ResearchConfig, Summary } from './types.js';

export class ResearchCollector {
  private readonly ctx: CollectorContext;
  private readonly startTime = Date.now();

  private readonly interceptors: Interceptor[];
  private readonly monitors: Monitor[];
  private readonly performanceMonitor: PerformanceMonitor;
  private readonly exporter: Exporter;
  private analyzeExistingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(overrides: Partial<ResearchConfig> = {}) {
    const config = mergeConfig(overrides);
    this.ctx = new CollectorContext(config);
    const analyzer = new ResponseAnalyzer(this.ctx);

    this.interceptors = [
      new FetchInterceptor(this.ctx, analyzer),
      new XhrInterceptor(this.ctx, analyzer),
      new WebSocketInterceptor(this.ctx, analyzer),
      new BeaconInterceptor(this.ctx),
      new EventSourceInterceptor(this.ctx, analyzer),
      new DomResourceInterceptor(this.ctx),
    ];

    this.performanceMonitor = new PerformanceMonitor(this.ctx);

    this.monitors = [
      new EventMonitor(this.ctx),
      new ErrorMonitor(this.ctx),
      new StorageMonitor(this.ctx),
      new GlobalObjectMonitor(this.ctx),
      new NavigationMonitor(this.ctx),
      ...(config.enablePerformance ? [this.performanceMonitor as Monitor] : []),
      ...(config.enableMutations ? [new MutationMonitor(this.ctx) as Monitor] : []),
    ];

    this.exporter = new Exporter(
      this.ctx,
      this.startTime,
      () => this.getSummary(),
      () => this.getEndpoints(),
      () => this.getJsonResponses(),
      () => this.getWebSockets(),
    );

    this.init();
  }

  private init(): void {
    this.ctx.logger.log('info', '🔬 BROWSER RESEARCH TOOLKIT ACTIVATED');

    for (const interceptor of this.interceptors) interceptor.install();
    for (const monitor of this.monitors) monitor.install();

    window.addEventListener('beforeunload', () => this.cleanup());
    this.analyzeExistingTimer = setTimeout(() => this.performanceMonitor.analyzeExistingRequests(), 2000);

    this.ctx.logger.printHelp(this.ctx.config);
  }

  // ===== Public API (mirrors the original window.research surface) =====

  getSummary(): Summary {
    const now = Date.now();
    this.ctx.syncRedactedCount();
    this.ctx.pruneAll();

    return {
      status: this.ctx.isActive ? 'active' : 'stopped',
      uptime: `${Math.floor((now - this.startTime) / 1000)}s`,
      stats: {
        ...this.ctx.stats,
        droppedRequests: this.ctx.droppedRequests,
        droppedEvents: this.ctx.droppedEvents,
        requestsInMemory: this.ctx.networkRequests.length,
        eventsInMemory: Array.from(this.ctx.events.values()).reduce((sum, list) => sum + list.length, 0),
      },
      collections: {
        endpoints: this.ctx.endpoints.size,
        jsonResponses: this.ctx.jsonData.size,
        websockets: this.ctx.websockets.size,
        eventTypes: this.ctx.events.size,
        errors: this.ctx.logger.getErrors().length,
        performanceEntries: this.ctx.performanceData.size,
        localStorageItems: this.ctx.localStorageMap.size,
        sessionStorageItems: this.ctx.sessionStorageMap.size,
        cookies: this.ctx.cookies.size,
        globalObjects: this.ctx.globalObjects.size,
        beacons: this.ctx.beacons.length,
        eventSources: this.ctx.eventSources.size,
        dynamicResources: this.ctx.dynamicResources.length,
        navigations: this.ctx.navigationHistory.length,
      },
      noise: {
        excludedTotal: this.ctx.excludedTotal,
        byRule: Object.fromEntries(this.ctx.excludedStats),
      },
      config: {
        maxRequests: this.ctx.config.maxRequests,
        maxEvents: this.ctx.config.maxEvents,
        maxEndpoints: this.ctx.config.maxEndpoints,
        maxJsonResponses: this.ctx.config.maxJsonResponses,
        redactSensitive: this.ctx.config.redactSensitive,
        logLevel: this.ctx.config.logLevel,
        endpointTtl: this.ctx.config.endpointTtl,
      },
    };
  }

  getEndpoints() {
    return this.ctx.endpoints.values().map((ep) => ({
      id: ep.id,
      url: ep.url,
      method: ep.method,
      type: ep.type,
      timestamp: ep.timestamp,
      hasJsonResponse: !!ep.jsonData,
      duplicateCount: ep.duplicateCount ?? 1,
    }));
  }

  getJsonResponses() {
    return this.ctx.jsonData.values().map((entry) => ({
      requestId: entry.request.id,
      url: entry.request.url,
      method: entry.request.method,
      response: entry.response,
      timestamp: entry.timestamp,
    }));
  }

  getWebSockets() {
    return this.ctx.websockets.values().map((ws) => ({
      id: ws.id,
      url: ws.url,
      state: ws.state,
      messageCount: ws.messages.length,
      timestamp: ws.timestamp,
    }));
  }

  getWebSocketMessages(id: string) {
    return this.ctx.websockets.get(id)?.messages ?? [];
  }

  getBeacons() {
    return this.ctx.beacons.toArray();
  }

  getEventSources() {
    return this.ctx.eventSources.values();
  }

  getDynamicResources() {
    return this.ctx.dynamicResources.toArray();
  }

  getNavigationHistory() {
    return this.ctx.navigationHistory.toArray();
  }

  getExcludedStats() {
    return { total: this.ctx.excludedTotal, byRule: Object.fromEntries(this.ctx.excludedStats) };
  }

  getErrors() {
    return this.ctx.logger.getErrors();
  }

  exportData() {
    return this.exporter.exportAsJsonFile();
  }

  clearData(): void {
    this.ctx.endpoints.clear();
    this.ctx.endpointFingerprints.clear();
    this.ctx.jsonData.clear();
    this.ctx.websockets.clear();
    this.ctx.events.clear();
    this.ctx.logger.clearErrors();
    this.ctx.performanceData.clear();
    this.ctx.localStorageMap.clear();
    this.ctx.sessionStorageMap.clear();
    this.ctx.cookies.clear();
    this.ctx.globalObjects.clear();
    this.ctx.networkRequests.clear();
    this.ctx.beacons.clear();
    this.ctx.eventSources.clear();
    this.ctx.dynamicResources.clear();
    this.ctx.navigationHistory.clear();
    this.ctx.mutationDiscoveries.clear();
    this.ctx.excludedStats.clear();
    this.ctx.logger.log('info', '🗑️ All research data cleared');
  }

  stop(): void {
    this.ctx.stop();
    this.ctx.logger.log('warn', '⏸️ Research collector stopped');
  }

  start(): void {
    this.ctx.start();
    this.ctx.logger.log('info', '▶️ Research collector started');
  }

  cleanup(): void {
    this.stop();
    if (this.analyzeExistingTimer) {
      clearTimeout(this.analyzeExistingTimer);
      this.analyzeExistingTimer = null;
    }
    for (const interceptor of this.interceptors) interceptor.restore();
    for (const monitor of this.monitors) monitor.teardown?.();
    this.ctx.logger.log('info', '🧹 Cleanup completed, original functions restored');
  }
}
