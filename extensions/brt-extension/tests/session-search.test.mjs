import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS } from '../src/shared.js';
import { searchSession } from '../src/session-search.js';

function sessionFixture() {
  return {
    pageUrl: 'https://example.test/page',
    html: '<main>Needle HTML</main>',
    sources: [
      {
        id: 'src-1',
        label: 'app.js',
        url: 'https://example.test/app.js',
        type: 'external',
        text: 'const needleValue = true;'
      }
    ],
    network: [
      {
        kind: 'network-request',
        data: {
          requestId: 'r1',
          url: 'https://example.test/api/needle'
        }
      }
    ],
    runtime: [
      { key: 'needleKey', value: 'runtime-value', type: 'string' }
    ],
    timeline: [
      {
        label: 'timeline event',
        kind: 'network-request',
        sequence: 7,
        data: { url: 'https://example.test/timeline/needle' }
      }
    ],
    diagnostics: [
      { kind: 'needle-diagnostic', detail: 'diagnostic-value' }
    ],
    correlations: [
      { ruleId: 'needle-correlation', detail: 'correlation-value' }
    ],
    antiBot: {
      signals: [
        { kind: 'signal', categories: ['needle', 'challenge'] }
      ]
    }
  };
}

test('searchSession searches selected evidence scopes', () => {
  const results = searchSession(
    sessionFixture(),
    'needle',
    {
      html: true,
      javascript: true,
      network: true,
      runtime: true,
      timeline: true,
      diagnostics: true
    }
  );

  const scopes = new Set(results.map(item => item.scope));

  assert.ok(scopes.has('HTML'));
  assert.ok(scopes.has('JAVASCRIPT'));
  assert.ok(scopes.has('NETWORK'));
  assert.ok(scopes.has('RUNTIME'));
  assert.ok(scopes.has('TIMELINE'));
  assert.ok(scopes.has('DIAGNOSTICS'));
  assert.ok(scopes.has('CORRELATION'));
  assert.ok(scopes.has('ANTI-BOT'));
});

test('searchSession supports case-sensitive regular expressions', () => {
  const matching = searchSession(
    sessionFixture(),
    'Needle\\s+HTML',
    { html: true, timeline: false, regex: true, caseSensitive: true }
  );

  const missing = searchSession(
    sessionFixture(),
    'needle\\s+html',
    { html: true, timeline: false, regex: true, caseSensitive: true }
  );

  assert.equal(matching.length, 1);
  assert.equal(missing.length, 0);
});

test('searchSession preserves plain-search fallback for invalid regex', () => {
  const fixture = sessionFixture();
  fixture.html = 'literal [needle text';

  const results = searchSession(
    fixture,
    '[needle',
    { html: true, timeline: false, regex: true }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].scope, 'HTML');
});

test('searchSession searches timeline unless explicitly disabled', () => {
  const defaultResults = searchSession(
    sessionFixture(),
    'needle',
    {}
  );

  const disabledResults = searchSession(
    sessionFixture(),
    'needle',
    { timeline: false }
  );

  assert.ok(defaultResults.some(item => item.scope === 'TIMELINE'));
  assert.equal(disabledResults.length, 0);
});

test('searchSession enforces the shared result bound', () => {
  const fixture = sessionFixture();
  fixture.timeline = Array.from(
    { length: LIMITS.maxSearchResults + 25 },
    (_, index) => ({
      label: `event-${index}`,
      kind: 'custom',
      sequence: index,
      data: { text: 'needle' }
    })
  );

  const results = searchSession(
    fixture,
    'needle',
    {}
  );

  assert.equal(results.length, LIMITS.maxSearchResults);
});
