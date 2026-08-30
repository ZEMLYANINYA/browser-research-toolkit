import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUrl, sanitizeTextBody } from '../src/shared.js';
import { buildDomNetworkCorrelation } from '../src/session-utils.js';

test('sanitizeUrl redacts sensitive query values and opaque fragments', () => {
  const result = sanitizeUrl('https://example.test/api?apiKey=secret123&q=bearing#opaqueValue123');
  assert.match(result, /apiKey=%5BREDACTED%5D/);
  assert.match(result, /q=bearing/);
  assert.match(result, /#%5BREDACTED%5D|#\[REDACTED\]/);
  assert.doesNotMatch(result, /secret123|opaqueValue123/);
});

test('structured body redaction preserves sibling fields', () => {
  const result = sanitizeTextBody(JSON.stringify({ name: 'Acme', token: 'secret', nested: { password: 'hidden', count: 3 } }));
  const parsed = JSON.parse(result);
  assert.equal(parsed.name, 'Acme');
  assert.equal(parsed.token, '[REDACTED]');
  assert.equal(parsed.nested.password, '[REDACTED]');
  assert.equal(parsed.nested.count, 3);
});

test('DOM/network correlation requires same session and document', () => {
  const interaction = { kind: 'dom-event', eventId: 'd1', sequence: 10, wallTime: 1000, sessionId: 's1', documentId: 'doc1', data: { isTrusted: true, eventType: 'click' } };
  const request = { kind: 'network-request', eventId: 'n1', sequence: 12, wallTime: 1200, sessionId: 's1', documentId: 'doc1', data: { url: 'https://example.test/api' } };
  assert.ok(buildDomNetworkCorrelation(interaction, request));
  assert.equal(buildDomNetworkCorrelation(interaction, { ...request, documentId: 'doc2' }), null);
  assert.equal(buildDomNetworkCorrelation(interaction, { ...request, sessionId: 's2' }), null);
});
