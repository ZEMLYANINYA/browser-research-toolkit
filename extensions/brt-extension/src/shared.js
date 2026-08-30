export const CHANNEL = '__BRT_LAB_V01__';

export const LIMITS = Object.freeze({
  maxTimelineEvents: 2500,
  maxNetworkRecords: 1000,
  maxSources: 120,
  maxSourceChars: 300_000,
  maxResponseChars: 80_000,
  maxHtmlChars: 1_500_000,
  maxRuntimeEntries: 4000,
  maxSearchResults: 300,
  maxBodyBytes: 2_000_000,
  maxSourceDownloadBytes: 2_000_000,
  maxStructuredBodyChars: 120_000,
  maxBodyPreviewChars: 80_000,
  maxPersistedBytes: 25_000_000,
  maxDiagnostics: 300,
  maxAntiBotSignals: 500
});

export const SENSITIVE_QUERY_KEYS = new Set([
  'key', 'token', 'apikey', 'api_key', 'secret', 'auth', 'password',
  'access_token', 'refresh_token', 'session', 'sessionid', 'session_id', 'csrf', 'xsrf', 'code', 'signature', 'sig', 'jwt',
  'cid', 'sid', 'visitorid', 'visitor_id', 'clientid', 'client_id', 'deviceid', 'device_id', 'trackingid', 'tracking_id',
  'auid', 'ecid', 'gclid', 'fbclid', 'msclkid', '_ga', '_gid'
]);

export const SENSITIVE_FIELD = /^(authorization|proxy-authorization|cookie|set-cookie|x-csrf.*|x-xsrf.*|.*(?:token|secret|password|passwd|apikey|api_key|access_token|refresh_token|session|signature|jwt|visitor[_-]?id|client[_-]?id|device[_-]?id|tracking[_-]?id).*)$/i;

const SENSITIVE_ASSIGNMENT = /\b(csrf|xsrf|access[_-]?token|refresh[_-]?token|password|passwd|secret|api[_-]?key|session(?:id)?|signature|jwt|token|visitor[_-]?id|client[_-]?id|device[_-]?id|tracking[_-]?id)\b\s*["']?\s*[:=]\s*["']?([^\s,&"'}]+)/gi;
const AUTH_HEADER_TEXT = /\b(authorization|proxy-authorization)\b\s*["']?\s*[:=]\s*["']?[^\r\n,;&}]+/gi;
const COOKIE_HEADER_TEXT = /\b(cookie|set-cookie)\b\s*["']?\s*[:=]\s*["']?[^\r\n}]+/gi;

function normalizedKeyParts(key) {
  return String(key || '').toLowerCase().split(/[.\[\]_-]+/).filter(Boolean);
}

export function isSensitiveQueryKey(key) {
  const lower = String(key || '').toLowerCase();
  if (SENSITIVE_QUERY_KEYS.has(lower)) return true;
  const compact = lower.replace(/[^a-z0-9]/g, '');
  if (SENSITIVE_QUERY_KEYS.has(compact)) return true;
  return normalizedKeyParts(lower).some(part => SENSITIVE_QUERY_KEYS.has(part) || /^(visitor|client|device|tracking)id$/.test(part));
}

export function redactSensitiveText(value, maxChars = 80_000) {
  return trimText(String(value ?? '')
    .replace(AUTH_HEADER_TEXT, '$1=[REDACTED]')
    .replace(COOKIE_HEADER_TEXT, '$1=[REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT, '$1=[REDACTED]'), maxChars);
}

export function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl ?? '';
  try {
    const baseUrl = typeof location === 'undefined' ? undefined : location.href;
    const url = new URL(rawUrl, baseUrl);
    for (const key of [...url.searchParams.keys()]) {
      const value = url.searchParams.get(key) || '';
      if (isSensitiveQueryKey(key)) {
        url.searchParams.set(key, '[REDACTED]');
      } else if (value.length > 256) {
        url.searchParams.set(key, `[TRUNCATED:${value.length}]`);
      }
    }
    if (url.hash) {
      const hash = url.hash.slice(1);
      const params = new URLSearchParams(hash);
      let changed = false;
      for (const key of [...params.keys()]) {
        if (isSensitiveQueryKey(key)) {
          params.set(key, '[REDACTED]');
          changed = true;
        }
      }
      // Opaque fragments can carry credentials/session material and are not
      // required for BRT's endpoint identity. Preserve only sanitized params.
      url.hash = changed ? params.toString() : '[REDACTED]';
    }
    return url.toString();
  } catch {
    // Fail closed. Malformed URLs must never echo raw page-controlled text into
    // an export because the parser failure may be caused by secret-bearing data.
    return '[UNPARSEABLE_URL_REDACTED]';
  }
}

export function trimText(value, maxChars) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length > maxChars ? text.slice(0, maxChars) + '\n/* …truncated… */' : text;
}

export function safeJsonStringify(value, maxChars = 50_000) {
  const seen = new WeakSet();
  let text;
  try {
    text = JSON.stringify(value, (_key, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
      if (typeof v === 'symbol') return v.toString();
      return v;
    });
  } catch {
    text = String(value);
  }
  return trimText(text ?? '', maxChars);
}

function ownDataValue(object, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return '[MISSING]';
    if ('value' in descriptor) return descriptor.value;
    return '[ACCESSOR_NOT_INVOKED]';
  } catch {
    return '[UNREADABLE]';
  }
}

export function sanitizeStructured(value, depth = 0, seen = new WeakSet()) {
  if (depth > 7) return '[DepthLimit]';
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    const keys = Object.keys(value).slice(0, 200);
    if (Array.isArray(value)) return keys.map(key => sanitizeStructured(ownDataValue(value, key), depth + 1, seen));
    const result = {};
    for (const key of keys) result[key] = SENSITIVE_FIELD.test(key) ? '[REDACTED]' : sanitizeStructured(ownDataValue(value, key), depth + 1, seen);
    return result;
  } finally {
    seen.delete(value);
  }
}

export function sanitizeTextBody(value, maxChars = LIMITS.maxBodyPreviewChars) {
  if (typeof value !== 'string') return '';
  if (value.length <= LIMITS.maxStructuredBodyChars) {
    try { return trimText(JSON.stringify(sanitizeStructured(JSON.parse(value))), maxChars); }
    catch {}
  }
  return redactSensitiveText(value.slice(0, maxChars), maxChars);
}
