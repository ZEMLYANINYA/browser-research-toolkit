import { isExtensionSensitiveFieldName, isExtensionSensitiveQueryKey, sanitizeUrlWithPolicy, truncateText } from '../dist/shared-text.js';

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

const SENSITIVE_ASSIGNMENT = /\b(csrf|xsrf|access[_-]?token|refresh[_-]?token|password|passwd|secret|api[_-]?key|session(?:id)?|signature|jwt|token|visitor[_-]?id|client[_-]?id|device[_-]?id|tracking[_-]?id)\b\s*["']?\s*[:=]\s*["']?([^\s,&"'}]+)/gi;
const AUTH_HEADER_TEXT = /\b(authorization|proxy-authorization)\b\s*["']?\s*[:=]\s*["']?[^\r\n,;&}]+/gi;
const COOKIE_HEADER_TEXT = /\b(cookie|set-cookie)\b\s*["']?\s*[:=]\s*["']?[^\r\n}]+/gi;

export function redactSensitiveText(value, maxChars = 80_000) {
  return trimText(String(value ?? '')
    .replace(AUTH_HEADER_TEXT, '$1=[REDACTED]')
    .replace(COOKIE_HEADER_TEXT, '$1=[REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT, '$1=[REDACTED]'), maxChars);
}

export function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl ?? '';

  const baseUrl =
    typeof location === 'undefined'
      ? undefined
      : location.href;

  return sanitizeUrlWithPolicy(rawUrl, {
    isSensitiveQueryKey: isExtensionSensitiveQueryKey,
    baseUrl,
    maxQueryValueLength: 256,
    sanitizeHash: true,
    redactOpaqueHash: true,
    malformedResult: '[UNPARSEABLE_URL_REDACTED]'
  });
}

export function trimText(value, maxChars) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return truncateText(text, maxChars, '\n/* …truncated… */');
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
    for (const key of keys) result[key] = isExtensionSensitiveFieldName(key) ? '[REDACTED]' : sanitizeStructured(ownDataValue(value, key), depth + 1, seen);
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
