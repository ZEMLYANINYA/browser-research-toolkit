/**
 * Normalized identity of a request for dedup purposes: same method + path +
 * sorted param *names* (not values) collapse into one endpoint entry instead
 * of each call taking a fresh slot. Deliberately excludes common
 * cache-busting / correlation params so `?_reqid=123` vs `?_reqid=456` still
 * count as the same call.
 */
const VOLATILE_PARAMS = new Set([
  '_reqid',
  'reqid',
  'timestamp',
  'ts',
  'cachebust',
  '_',
  'sessionid',
  'session_id',
  'rid',
  'zx',
]);

export function computeFingerprint(method: string | undefined, url: string): string {
  const verb = (method ?? 'GET').toUpperCase();

  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
    const paramNames = Array.from(parsed.searchParams.keys())
      .filter((name) => !VOLATILE_PARAMS.has(name.toLowerCase()))
      .sort();
    return `${verb}:${parsed.origin}${parsed.pathname}:${paramNames.join(',')}`;
  } catch {
    // Not a parseable absolute/relative URL (rare) — fall back to the raw string
    // rather than throwing; dedup just won't kick in for this one request.
    return `${verb}:${url}`;
  }
}
