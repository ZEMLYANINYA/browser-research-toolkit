import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySourceFetchPolicy } from '../src/source-policy.js';

test('same-hostname source fetch is allowed by default', () => {
  const result = classifySourceFetchPolicy({ pageUrl: 'https://example.test/page', sourceUrl: 'https://example.test/app.js' });
  assert.deepEqual(result, { allowed: true, firstParty: true, classification: 'first-party', reason: 'same-hostname' });
});

test('third-party source fetch is blocked by default', () => {
  const result = classifySourceFetchPolicy({ pageUrl: 'https://example.test/page', sourceUrl: 'https://cdn.example.net/app.js' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'third-party-disabled');
  assert.equal(result.classification, 'third-party');
});

test('third-party source fetch requires explicit opt-in', () => {
  const result = classifySourceFetchPolicy({ pageUrl: 'https://example.test/page', sourceUrl: 'https://cdn.example.net/app.js', allowThirdParty: true });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'third-party-opt-in');
});

test('unsupported and malformed URLs fail closed', () => {
  assert.equal(classifySourceFetchPolicy({ pageUrl: 'https://example.test', sourceUrl: 'file:///tmp/a.js' }).allowed, false);
  assert.equal(classifySourceFetchPolicy({ pageUrl: 'not-a-url', sourceUrl: 'https://example.test/a.js' }).allowed, false);
  assert.equal(classifySourceFetchPolicy({ pageUrl: 'https://example.test', sourceUrl: 'not-a-url' }).allowed, false);
});
