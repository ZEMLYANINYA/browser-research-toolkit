import { SENSITIVE_PATTERNS } from '../config.js';
import type { ResearchConfig } from '../types.js';

const REDACTED_QUERY_PARAMS = ['key', 'token', 'apikey', 'api_key', 'secret', 'auth', 'password'];

export class Sanitizer {
  private redactedCount = 0;

  constructor(private readonly config: ResearchConfig) {}

  /** Total number of fields/values redacted so far — feeds CollectorStats.redactedItems. */
  get redactedItems(): number {
    return this.redactedCount;
  }

  containsSensitiveData(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return Object.values(SENSITIVE_PATTERNS).some((pattern) => pattern.test(value));
  }

  sanitizeUrl(url: string): string {
    if (!this.config.redactSensitive) return url;

    try {
      const urlObj = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
      const redactedParamsLower = REDACTED_QUERY_PARAMS.map((p) => p.toLowerCase());

      for (const param of Array.from(urlObj.searchParams.keys())) {
        if (redactedParamsLower.includes(param.toLowerCase())) {
          urlObj.searchParams.set(param, '[REDACTED]');
        }
      }
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  sanitizeHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
    if (!headers || !this.config.redactSensitive) {
      return headers as Record<string, string> | undefined;
    }

    const headersObj: Record<string, string> =
      headers instanceof Headers ? Object.fromEntries(headers.entries()) : (headers as Record<string, string>);

    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headersObj)) {
      if (SENSITIVE_PATTERNS.auth.test(key) || SENSITIVE_PATTERNS.apiKey.test(key)) {
        sanitized[key] = '[REDACTED]';
        this.redactedCount++;
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  sanitizeBody(body: unknown, url = ''): unknown {
    if (!body) return null;
    if (!this.config.redactSensitive) return this.truncate(String(body), 500);

    if (/login|auth|register|password/i.test(url)) {
      this.redactedCount++;
      return '[REDACTED - Auth endpoint]';
    }

    if (typeof body === 'string') {
      if (this.containsSensitiveData(body)) {
        this.redactedCount++;
        return '[REDACTED - Contains sensitive data]';
      }
      return this.truncate(body, 500);
    }

    return '[Binary Data]';
  }

  sanitizeObject(obj: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
    if (depth > this.config.circularRefDepth) {
      return '[Max depth reached]';
    }

    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (seen.has(obj as object)) {
      return '[Circular Reference]';
    }
    seen.add(obj as object);

    try {
      if (Array.isArray(obj)) {
        const arr = obj.slice(0, 10).map((item) => this.sanitizeObject(item, depth + 1, seen));
        if (obj.length > 10) arr.push(`[+${obj.length - 10} more]`);
        return arr;
      }

      const keys = Object.keys(obj as Record<string, unknown>);
      const truncated = keys.length > 50;
      const limitedKeys = truncated ? keys.slice(0, 50) : keys;
      const sanitized: Record<string, unknown> = {};

      for (const key of limitedKeys) {
        if (this.containsSensitiveData(key)) {
          sanitized[key] = '[REDACTED]';
          this.redactedCount++;
          continue;
        }
        try {
          sanitized[key] = this.sanitizeObject((obj as Record<string, unknown>)[key], depth + 1, seen);
        } catch {
          sanitized[key] = '[Error accessing property]';
        }
      }

      if (truncated) sanitized.__keys_truncated__ = keys.length;
      return sanitized;
    } finally {
      seen.delete(obj as object);
    }
  }

  sanitizeStorageValue(value: string, key: string): unknown {
    if (this.containsSensitiveData(key)) {
      this.redactedCount++;
      return '[REDACTED]';
    }

    try {
      return this.sanitizeObject(JSON.parse(value));
    } catch {
      return this.truncate(value, 200);
    }
  }

  sanitizeWebSocketData(data: unknown): unknown {
    if (typeof data === 'string') {
      if (this.containsSensitiveData(data)) {
        this.redactedCount++;
        return '[REDACTED]';
      }
      return this.truncate(data, 500);
    }
    return '[Binary Data]';
  }

  truncate(str: unknown, maxLength: number): string {
    const s = typeof str === 'string' ? str : String(str);
    return s.length > maxLength ? s.slice(0, maxLength) + '...' : s;
  }
}
