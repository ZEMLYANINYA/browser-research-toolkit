export const EXTENSION_SENSITIVE_FIELD_PATTERN =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-csrf.*|x-xsrf.*|.*(?:token|secret|password|passwd|apikey|api_key|access_token|refresh_token|session|signature|jwt|visitor[_-]?id|client[_-]?id|device[_-]?id|tracking[_-]?id).*)$/i;

export function isExtensionSensitiveFieldName(value: unknown): boolean {
  return EXTENSION_SENSITIVE_FIELD_PATTERN.test(String(value ?? ''));
}
export const EXTENSION_SENSITIVE_QUERY_KEYS = new Set([
  'key', 'token', 'apikey', 'api_key', 'secret', 'auth', 'password',
  'access_token', 'refresh_token', 'session', 'sessionid', 'session_id', 'csrf', 'xsrf', 'code', 'signature', 'sig', 'jwt',
  'cid', 'sid', 'visitorid', 'visitor_id', 'clientid', 'client_id', 'deviceid', 'device_id', 'trackingid', 'tracking_id',
  'auid', 'ecid', 'gclid', 'fbclid', 'msclkid', '_ga', '_gid'
]);

function normalizedExtensionQueryKeyParts(key: unknown): string[] {
  return String(key ?? '')
    .toLowerCase()
    .split(/[.\[\]_-]+/)
    .filter(Boolean);
}

export function isExtensionSensitiveQueryKey(key: unknown): boolean {
  const lower = String(key ?? '').toLowerCase();

  if (EXTENSION_SENSITIVE_QUERY_KEYS.has(lower)) {
    return true;
  }

  const compact =
    lower.replace(/[^a-z0-9]/g, '');

  if (EXTENSION_SENSITIVE_QUERY_KEYS.has(compact)) {
    return true;
  }

  return normalizedExtensionQueryKeyParts(lower).some(
    (part) =>
      EXTENSION_SENSITIVE_QUERY_KEYS.has(part) ||
      /^(visitor|client|device|tracking)id$/.test(part)
  );
}
const EXTENSION_SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(csrf|xsrf|access[_-]?token|refresh[_-]?token|password|passwd|secret|api[_-]?key|session(?:id)?|signature|jwt|token|visitor[_-]?id|client[_-]?id|device[_-]?id|tracking[_-]?id)\b\s*["']?\s*[:=]\s*["']?([^\s,&"'}]+)/gi;

const EXTENSION_AUTH_HEADER_TEXT_PATTERN =
  /\b(authorization|proxy-authorization)\b\s*["']?\s*[:=]\s*["']?[^\r\n,;&}]+/gi;

const EXTENSION_COOKIE_HEADER_TEXT_PATTERN =
  /\b(cookie|set-cookie)\b\s*["']?\s*[:=]\s*["']?[^\r\n}]+/gi;

export function redactExtensionSensitiveText(value: unknown): string {
  return String(value ?? '')
    .replace(EXTENSION_AUTH_HEADER_TEXT_PATTERN, '$1=[REDACTED]')
    .replace(EXTENSION_COOKIE_HEADER_TEXT_PATTERN, '$1=[REDACTED]')
    .replace(EXTENSION_SENSITIVE_ASSIGNMENT_PATTERN, '$1=[REDACTED]');
}
