export interface UrlSanitizationPolicy {
  isSensitiveQueryKey: (key: string) => boolean;
  baseUrl?: string;
  maxQueryValueLength?: number;
  sanitizeHash?: boolean;
  redactOpaqueHash?: boolean;
  malformedResult?: string;
}

export function sanitizeUrlWithPolicy(
  rawUrl: string,
  policy: UrlSanitizationPolicy
): string {
  try {
    const url = new URL(rawUrl, policy.baseUrl);

    for (const key of Array.from(url.searchParams.keys())) {
      const value = url.searchParams.get(key) || '';

      if (policy.isSensitiveQueryKey(key)) {
        url.searchParams.set(key, '[REDACTED]');
      } else if (
        policy.maxQueryValueLength !== undefined &&
        value.length > policy.maxQueryValueLength
      ) {
        url.searchParams.set(key, `[TRUNCATED:${value.length}]`);
      }
    }

    if (policy.sanitizeHash && url.hash) {
      const params = new URLSearchParams(url.hash.slice(1));
      let changed = false;

      for (const key of Array.from(params.keys())) {
        if (policy.isSensitiveQueryKey(key)) {
          params.set(key, '[REDACTED]');
          changed = true;
        }
      }

      if (changed) {
        url.hash = params.toString();
      } else if (policy.redactOpaqueHash) {
        url.hash = '[REDACTED]';
      }
    }

    return url.toString();
  } catch {
    return policy.malformedResult ?? rawUrl;
  }
}
