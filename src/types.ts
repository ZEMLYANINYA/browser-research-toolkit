export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ResearchConfig {
  maxRequests: number;
  maxEvents: number;
  maxStorageItems: number;
  maxEndpoints: number;
  maxJsonResponses: number;
  maxResponseSize: number;
  endpointTtl: number;
  maxWebSockets: number;
  maxPerformanceEntries: number;
  redactSensitive: boolean;
  enablePerformance: boolean;
  enableMutations: boolean;
  enableMouseTracking: boolean;
  logLevel: LogLevel;
  autoExportOnUnload?: boolean;
  beaconUrl?: string;
  circularRefDepth: number;
  keywords: string[];
  /** Global objects to snapshot on init, e.g. ['google', 'gm', 'config'] */
  globalObjectNames: string[];
  /**
   * Regexes tested against the full URL — a match means "don't register as an
   * endpoint, count it as noise instead." Empty by default on purpose: this
   * stays a generic tool, site-specific patterns (e.g. Google's /log204) are
   * something you supply via window.RESEARCH_CONFIG for the site you're on,
   * not something baked into the published defaults.
   */
  excludeRules: RegExp[];
}

export type RequestKind = 'fetch' | 'xhr' | 'websocket' | 'beacon' | 'eventsource';

export interface RequestData {
  id: string;
  type: RequestKind;
  url: string;
  method?: string;
  timestamp: number;
  headers?: Record<string, string>;
  body?: unknown;
  status?: number;
  statusText?: string;
  contentType?: string;
  responseType?: 'json' | 'text';
  responseText?: string;
  jsonData?: Record<string, unknown> | unknown[] | unknown;
  /** How many times a request with the same fingerprint (method+path+param names) was seen. */
  duplicateCount?: number;
}

/** Tracks which stored endpoint a given request fingerprint maps to, for dedup. */
export interface FingerprintRecord {
  endpointId: string;
  timestamp: number;
}

export interface WebSocketMessage {
  type: 'sent' | 'received';
  data: unknown;
  timestamp: number;
}

export type WebSocketState = 'connecting' | 'open' | 'closed' | 'error';

export interface WebSocketData {
  id: string;
  type: 'websocket';
  url: string;
  protocols?: string | string[];
  timestamp: number;
  messages: WebSocketMessage[];
  state: WebSocketState;
  closedAt?: number;
}

export interface StorageEntry {
  value: unknown;
  timestamp: number;
  size?: number;
}

export interface ErrorEntry {
  type: string;
  error: string;
  context?: unknown;
  timestamp: number;
  stack?: string;
}

export interface PerformanceEntryData {
  name: string;
  duration: number;
  startTime?: number;
  type?: string;
  initiatorType?: string;
  transferSize?: number;
  timestamp: number;
}

export interface CollectorStats {
  totalRequests: number;
  totalEvents: number;
  droppedRequests: number;
  droppedEvents: number;
  redactedItems: number;
}

export interface JsonDataEntry {
  request: RequestData;
  response: unknown;
  timestamp: number;
}

export interface EventRecord {
  type: string;
  timestamp: number;
  target: string;
  details: Record<string, unknown>;
}

export interface BeaconRecord {
  url: string;
  dataSize: number | 'unknown';
  timestamp: number;
}

export interface EventSourceMessage {
  eventType: string;
  data: unknown;
  lastEventId: string;
  timestamp: number;
}

export interface EventSourceRecord {
  id: string;
  url: string;
  withCredentials: boolean;
  state: 'connecting' | 'open' | 'closed' | 'error';
  timestamp: number;
  messages: EventSourceMessage[];
}

export interface DomResourceRecord {
  kind: 'script' | 'css';
  url: string;
  method: string;
  timestamp: number;
}

export type NavigationType = 'pushState' | 'replaceState' | 'popstate' | 'hashchange';

export interface NavigationRecord {
  type: NavigationType;
  from: string;
  to: string;
  timestamp: number;
}

export interface MutationDiscoveryRecord {
  attribute: string;
  value: string;
  timestamp: number;
}

export interface Summary {
  status: 'active' | 'stopped';
  uptime: string;
  stats: CollectorStats & { requestsInMemory: number; eventsInMemory: number };
  collections: {
    endpoints: number;
    jsonResponses: number;
    websockets: number;
    eventTypes: number;
    errors: number;
    performanceEntries: number;
    localStorageItems: number;
    sessionStorageItems: number;
    cookies: number;
    globalObjects: number;
    beacons: number;
    eventSources: number;
    dynamicResources: number;
    navigations: number;
  };
  noise: {
    excludedTotal: number;
    byRule: Record<string, number>;
  };
  config: Pick<
    ResearchConfig,
    'maxRequests' | 'maxEvents' | 'maxEndpoints' | 'maxJsonResponses' | 'redactSensitive' | 'logLevel' | 'endpointTtl'
  >;
}

export interface ExportPayload {
  meta: {
    exportTime: string;
    url: string;
    userAgent: string;
    version: string;
    uptime: number;
  };
  summary: Summary;
  endpoints: ReturnType<() => unknown>;
  jsonData: unknown;
  websockets: unknown;
  events: Record<string, EventRecord[]>;
  errors: ErrorEntry[];
  networkRequests: RequestData[];
  performanceData: PerformanceEntryData[];
  localStorage: Record<string, unknown>;
  sessionStorage: Record<string, unknown>;
  cookies: Record<string, unknown>;
  globalObjects: Record<string, unknown>;
  beacons: BeaconRecord[];
  eventSources: EventSourceRecord[];
  dynamicResources: DomResourceRecord[];
  navigationHistory: NavigationRecord[];
  noise: { excludedTotal: number; byRule: Record<string, number> };
}

/** Anything a module needs in order to install/restore its patch on the page. */
export interface Interceptor {
  install(): void;
  restore(): void;
}

/** Anything a module needs in order to start/stop passive observation. */
export interface Monitor {
  install(): void;
  teardown?(): void;
}
