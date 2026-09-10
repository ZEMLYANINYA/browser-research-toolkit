import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUrlWithPolicy } from '../../dist/shared/url.js';

const sensitive = key =>
  ['token', 'apikey'].includes(String(key).toLowerCase());

test('shared URL engine preserves Core-style behavior', () => {
  const out = sanitizeUrlWithPolicy(
    'https://example.test/api?token=secret&q=keep#fragment',
    {
      isSensitiveQueryKey: sensitive
    }
  );

  assert.equal(
    out,
    'https://example.test/api?token=%5BREDACTED%5D&q=keep#fragment'
  );
});

test('shared URL engine supports extension-style query limits and hash redaction', () => {
  const longValue = 'x'.repeat(300);

  const out = sanitizeUrlWithPolicy(
    `https://example.test/api?q=${longValue}#token=secret`,
    {
      isSensitiveQueryKey: sensitive,
      maxQueryValueLength: 256,
      sanitizeHash: true,
      redactOpaqueHash: true,
      malformedResult: '[UNPARSEABLE_URL_REDACTED]'
    }
  );

  assert.match(out, /q=%5BTRUNCATED%3A300%5D/);
  assert.match(out, /#token=%5BREDACTED%5D$/);
});

test('shared URL engine redacts opaque fragments when requested', () => {
  const out = sanitizeUrlWithPolicy(
    'https://example.test/page#opaque-fragment',
    {
      isSensitiveQueryKey: sensitive,
      sanitizeHash: true,
      redactOpaqueHash: true,
      malformedResult: '[UNPARSEABLE_URL_REDACTED]'
    }
  );

  assert.equal(
    out,
    'https://example.test/page#[REDACTED]'
  );
});

test('shared URL engine supports caller-defined malformed behavior', () => {
  const raw = 'http://[';

  assert.equal(
    sanitizeUrlWithPolicy(raw, {
      isSensitiveQueryKey: sensitive
    }),
    raw
  );

  assert.equal(
    sanitizeUrlWithPolicy(raw, {
      isSensitiveQueryKey: sensitive,
      malformedResult: '[UNPARSEABLE_URL_REDACTED]'
    }),
    '[UNPARSEABLE_URL_REDACTED]'
  );
});
