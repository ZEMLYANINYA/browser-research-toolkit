import type { ResearchConfig } from './types.js';

export const DEFAULT_CONFIG: ResearchConfig = {
  maxRequests: 500,
  maxEvents: 300,
  maxStorageItems: 100,
  maxEndpoints: 200,
  maxJsonResponses: 100,
  maxResponseSize: 1024 * 1024, // 1 MB
  endpointTtl: 3600_000, // 1 hour
  maxWebSockets: 50,
  maxPerformanceEntries: 300,
  redactSensitive: true,
  enablePerformance: true,
  enableMutations: false,
  enableMouseTracking: false,
  logLevel: 'info',
  circularRefDepth: 5,
  keywords: [
    'api', 'json', 'data', 'endpoint', 'rest', 'graphql',
    'auth', 'token', 'oauth', 'geocode', 'directions', 'route', 'search',
    'autocomplete', 'place', 'location', 'map', 'tile', 'vector', 'raster',
    'pbf', 'proto', 'grpc', 'websocket', 'sse', 'realtime',
  ],
  globalObjectNames: ['config', 'appConfig'],
  excludeRules: [],
};

export const SENSITIVE_PATTERNS = {
  apiKey: /api[_-]?key|apikey|api_secret/i,
  auth: /authorization|bearer|token|jwt|session/i,
  password: /password|passwd|pwd/i,
  credentials: /username|email|phone|ssn|credit[_-]?card/i,
  cookies: /cookie|csrf|xsrf/i,
} as const;

export function mergeConfig(overrides: Partial<ResearchConfig> = {}): ResearchConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
