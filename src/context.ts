import { Sanitizer } from './sanitize/sanitizer.js';
import { Logger } from './logging/logger.js';
import { BoundedList, BoundedStore } from './storage/bounded-store.js';
import type {
  BeaconRecord,
  CollectorStats,
  DomResourceRecord,
  EventRecord,
  EventSourceRecord,
  FingerprintRecord,
  JsonDataEntry,
  MutationDiscoveryRecord,
  NavigationRecord,
  PerformanceEntryData,
  RequestData,
  ResearchConfig,
  StorageEntry,
  WebSocketData,
} from './types.js';

/**
 * Shared state + helpers every interceptor/monitor needs.
 * Built once by ResearchCollector and injected into each module —
 * this is what replaces the `self` closure trick from the original script.
 */
export class CollectorContext {
  readonly stats: CollectorStats = {
    totalRequests: 0,
    totalEvents: 0,
    droppedRequests: 0,
    droppedEvents: 0,
    redactedItems: 0,
  };

  readonly sanitizer: Sanitizer;
  readonly logger: Logger;

  readonly networkRequests: BoundedList<RequestData>;
  readonly endpoints: BoundedStore<string, RequestData>;
  readonly endpointFingerprints: BoundedStore<string, FingerprintRecord>;
  readonly jsonData: BoundedStore<string, JsonDataEntry>;
  readonly websockets: BoundedStore<string, WebSocketData>;
  readonly events = new Map<string, BoundedList<EventRecord>>();
  readonly performanceData: BoundedStore<string, PerformanceEntryData>;
  readonly localStorageMap = new Map<string, StorageEntry>();
  readonly sessionStorageMap = new Map<string, StorageEntry>();
  readonly cookies = new Map<string, StorageEntry>();
  readonly globalObjects = new Map<string, unknown>();
  readonly beacons: BoundedList<BeaconRecord>;
  readonly eventSources: BoundedStore<string, EventSourceRecord>;
  readonly dynamicResources: BoundedList<DomResourceRecord>;
  readonly navigationHistory: BoundedList<NavigationRecord>;
  readonly mutationDiscoveries: BoundedList<MutationDiscoveryRecord>;
  readonly excludedStats = new Map<string, number>();

  private requestIdCounter = 0;
  private active = true;

  constructor(readonly config: ResearchConfig) {
    this.sanitizer = new Sanitizer(config);
    this.logger = new Logger(config);
    this.networkRequests = new BoundedList<RequestData>(config.maxRequests);
    this.endpoints = new BoundedStore<string, RequestData>(config.maxEndpoints, config.endpointTtl);
    this.endpointFingerprints = new BoundedStore<string, FingerprintRecord>(config.maxEndpoints, config.endpointTtl);
    this.jsonData = new BoundedStore<string, JsonDataEntry>(config.maxJsonResponses);
    // Keyed by connection id / by resource URL respectively — on a tile-heavy SPA like
    // Google Maps, performanceData in particular used to grow by one entry per unique
    // tile URL ever loaded (URLs matching "map"/"tile"/"vector" in the default keyword
    // list), forever, for the life of the tab. That was the only unbounded collection
    // in the whole context — everything else already went through BoundedList/BoundedStore.
    this.websockets = new BoundedStore<string, WebSocketData>(config.maxWebSockets);
    this.performanceData = new BoundedStore<string, PerformanceEntryData>(config.maxPerformanceEntries, config.endpointTtl);
    this.beacons = new BoundedList<BeaconRecord>(100);
    this.eventSources = new BoundedStore<string, EventSourceRecord>(50);
    this.dynamicResources = new BoundedList<DomResourceRecord>(200);
    this.navigationHistory = new BoundedList<NavigationRecord>(100);
    this.mutationDiscoveries = new BoundedList<MutationDiscoveryRecord>(200);
  }

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  generateId(): string {
    return `req_${++this.requestIdCounter}_${Date.now().toString(36)}`;
  }

  isApiEndpoint(url: string | undefined): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return this.config.keywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  /** True if the URL matches one of the configured noise filters (e.g. telemetry pings). */
  isExcluded(url: string): boolean {
    return this.config.excludeRules.some((rule) => rule.test(url));
  }

  /** Record a filtered-out URL in aggregate, keyed by which rule matched — so noise is
   *  visible in the summary/export instead of just silently vanishing. */
  recordExcluded(url: string): void {
    const matched = this.config.excludeRules.find((rule) => rule.test(url));
    const key = matched ? matched.source : 'unknown';
    this.excludedStats.set(key, (this.excludedStats.get(key) ?? 0) + 1);
  }

  recordRequest(data: RequestData): void {
    this.stats.totalRequests++;
    this.networkRequests.push(data);
  }

  recordEvent(type: string, record: EventRecord): void {
    this.stats.totalEvents++;
    if (!this.events.has(type)) {
      this.events.set(type, new BoundedList<EventRecord>(this.config.maxEvents));
    }
    this.events.get(type)!.push(record);
  }

  /** Drop counters live on the lists themselves (single source of truth) — pulled together here for the summary. */
  get droppedRequests(): number {
    return this.networkRequests.droppedCount;
  }

  get droppedEvents(): number {
    let total = 0;
    for (const list of this.events.values()) total += list.droppedCount;
    return total;
  }

  get excludedTotal(): number {
    let total = 0;
    for (const count of this.excludedStats.values()) total += count;
    return total;
  }

  /** Sync redacted-item count from the sanitizer into the shared stats object. */
  syncRedactedCount(): void {
    this.stats.redactedItems = this.sanitizer.redactedItems;
  }

  /** Force every bounded store to re-check TTL/size before a read (getSummary/export).
   *  Rotation used to only run on insert, so a collector left idle for a while could
   *  report entries that had actually already aged out. */
  pruneAll(): void {
    this.endpoints.prune();
    this.endpointFingerprints.prune();
    this.jsonData.prune();
    this.websockets.prune();
    this.performanceData.prune();
    this.eventSources.prune();
  }
}
