import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sanitizer } from '../../dist/sanitize/sanitizer.js';
import { mergeConfig } from '../../dist/config.js';

const sanitizer = new Sanitizer(mergeConfig());

test('redacts sensitive query params from a URL', () => {
  const url = sanitizer.sanitizeUrl('https://example.test/geocode?apikey=SECRET123&q=Berlin');
  assert.ok(!url.includes('SECRET123'), `leaked secret in: ${url}`);
  assert.ok(url.includes('q=Berlin'));
});

test('redacts headers by key name, leaves the rest untouched', () => {
  const headers = sanitizer.sanitizeHeaders({ Authorization: 'Bearer xyz', 'X-Custom': 'keep-me' });
  assert.equal(headers.Authorization, '[REDACTED]');
  assert.equal(headers['X-Custom'], 'keep-me');
});

test('redacts object fields whose key name looks sensitive', () => {
  const out = sanitizer.sanitizeObject({ apiKey: 'abc123', city: 'Warsaw' });
  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal(out.city, 'Warsaw');
});

test('redacts body sent to an auth-looking endpoint regardless of content', () => {
  const out = sanitizer.sanitizeBody('username=bob&password=hunter2', 'https://example.test/login');
  assert.equal(out, '[REDACTED - Auth endpoint]');
});

test('handles circular references without crashing', () => {
  const obj = { name: 'x' };
  obj.self = obj;
  const out = sanitizer.sanitizeObject(obj);
  assert.equal(out.self, '[Circular Reference]');
});

test('caps arrays at 10 items with a remainder marker', () => {
  const arr = Array.from({ length: 15 }, (_, i) => i);
  const out = sanitizer.sanitizeObject(arr);
  assert.equal(out.length, 11);
  assert.match(out[10], /\+5 more/);
});
