import { EXTENSION_CAPTURE_LIMITS, PAGE_EVENT_KINDS, isExtensionSensitiveFieldName, isExtensionSensitiveQueryKey, readResponseTextBounded, redactExtensionSensitiveText, redactExtensionSourceText, sanitizeUrlWithPolicy, truncateText, validatePageEventEnvelope } from '../dist/shared-text.js';

export { PAGE_EVENT_KINDS, validatePageEventEnvelope };

export { readResponseTextBounded, redactExtensionSourceText };

export const CHANNEL = '__BRT_LAB_V01__';

export const LIMITS = Object.freeze({
  ...EXTENSION_CAPTURE_LIMITS,
  maxTimelineEvents: 2500,
  maxNetworkRecords: 1000,
  maxSources: 120,
  maxSourceChars: 300_000,
  maxSearchResults: 300,
  maxBodyBytes: 2_000_000,
  maxSourceDownloadBytes: 2_000_000,
  maxBodyPreviewChars: 80_000,
  maxPersistedBytes: 25_000_000,
  maxDiagnostics: 300,
  maxAntiBotSignals: 500
});


export function redactSensitiveText(value, maxChars = 80_000) {
  return trimText(redactExtensionSensitiveText(value), maxChars);
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
