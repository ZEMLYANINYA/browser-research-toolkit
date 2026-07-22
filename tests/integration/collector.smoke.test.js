import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

function makeJsonResponse(body) {
  return {
    headers: { get: (key) => (key === 'content-type' ? 'application/json' : null) },
    status: 200,
    clone() {
      return this;
    },
    async text() {
      return body;
    },
  };
}

function makeTextResponse(body) {
  return {
    headers: { get: (key) => (key === 'content-type' ? 'text/plain' : null) },
    status: 200,
    clone() {
      return this;
    },
    async text() {
      return body;
    },
  };
}

test('ResearchCollector captures and redacts a fetch call, DOM event, and localStorage write end-to-end', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/page' });
  const { window } = dom;

  // jsdom doesn't ship fetch or a real Blob download pipeline — stub just enough
  // for the collector to exercise its normal code paths without crashing.
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};

  window.fetch = async (url) => {
    if (url.includes('/api/search')) {
      // Key name looks sensitive ("apiKey") but this is still valid, parseable JSON.
      // Fix under test: this should now be parsed and redacted *by field*, not
      // blacked out wholesale the way the coarse whole-body check used to.
      return makeJsonResponse(JSON.stringify({ apiKey: 'SECRET123', city: 'Warsaw' }));
    }
    if (url.includes('/api/city-info')) {
      return makeJsonResponse(JSON.stringify({ city: 'Warsaw', population: 1863056 }));
    }
    if (url.includes('/api/legacy-text')) {
      // Not valid JSON at all (simulates Google's `)]}'`-prefixed responses) *and*
      // contains a sensitive word — nothing to redact by field here, so the coarse
      // whole-body check is still the right (and only) tool for this path.
      return makeTextResponse(")]}'\n[\"session token abc123\"]");
    }
    return makeJsonResponse('{}');
  };

  // The bundle expects these as ambient globals (same contract browsers give it).
  global.window = window;
  global.document = window.document;
  global.Storage = window.Storage;
  global.Element = window.Element;
  global.MutationObserver = window.MutationObserver;
  global.MouseEvent = window.MouseEvent;
  global.KeyboardEvent = window.KeyboardEvent;
  global.HTMLInputElement = window.HTMLInputElement;
  global.HTMLTextAreaElement = window.HTMLTextAreaElement;
  global.performance = window.performance;
  global.URL = window.URL;
  global.history = window.history;

  const { ResearchCollector } = await import('../../dist/collector.js');
  const collector = new ResearchCollector({ logLevel: 'error', excludeRules: [/\/log204/i] });

  await window.fetch('https://example.test/api/search?apiKey=SECRET123&q=Warsaw', { method: 'GET' });
  await window.fetch('https://example.test/api/city-info?q=Warsaw', { method: 'GET' });
  await window.fetch('https://example.test/api/legacy-text', { method: 'GET' });
  // Same fingerprint (method + path + param *names*) called twice with a different
  // cache-busting value — should collapse into one endpoint entry, not two.
  await window.fetch('https://example.test/api/city-info?q=Warsaw&_reqid=1', { method: 'GET' });
  await window.fetch('https://example.test/api/city-info?q=Warsaw&_reqid=2', { method: 'GET' });
  // Noise: matches an excludeRule, should never become an endpoint entry at all.
  await window.fetch('https://example.test/api/preview/log204?x=1', { method: 'GET' });
  await new Promise((resolve) => setTimeout(resolve, 20)); // response analysis runs unawaited in the interceptor

  const endpoints = collector.getEndpoints();
  assert.ok(!endpoints.some((e) => e.url.includes('log204')), 'log204 matched an excludeRule and should have been filtered');
  assert.ok(!endpoints[0].url.includes('SECRET123'), `secret leaked into stored endpoint url: ${endpoints[0].url}`);

  const noise = collector.getExcludedStats();
  assert.equal(noise.total, 1, 'the log204 call should be counted as noise');

  // Dedup: /api/city-info was called 3 times total (once plain, twice with a
  // volatile _reqid) — all three share a fingerprint, so this should be ONE
  // endpoint entry with duplicateCount 3, not three separate entries.
  const cityInfo = endpoints.find((e) => e.url.includes('city-info'));
  assert.ok(cityInfo, 'expected a single deduped city-info endpoint entry');
  assert.equal(cityInfo.duplicateCount, 3, `expected 3 deduped hits, got ${cityInfo.duplicateCount}`);

  // Call #1: sensitive-looking KEY, but valid JSON -> parsed and redacted per field,
  // not blacked out wholesale. This is the actual fix: a real capture against Google
  // Maps showed the old wholesale check nuking the single most useful endpoint in
  // the session (place details) purely because "phone" appeared in the body text.
  const searchEndpoint = endpoints.find((e) => e.url.includes('search'));
  assert.equal(searchEndpoint.hasJsonResponse, true, 'valid JSON should be parsed and stored, not wholesale-redacted');

  const jsonResponses = collector.getJsonResponses();
  const searchResponse = jsonResponses.find((r) => r.url.includes('search'));
  assert.equal(searchResponse.response.apiKey, '[REDACTED]', 'the apiKey field itself should still be redacted');
  assert.equal(searchResponse.response.city, 'Warsaw', 'unrelated fields should survive field-level redaction');

  const cityInfoResponse = jsonResponses.find((r) => r.url.includes('city-info'));
  assert.equal(cityInfoResponse.response.population, 1863056);

  // Call #3: not parseable as JSON at all -> no field structure to redact by, so the
  // coarse whole-body check is still the right fallback, and it should still fire.
  const legacyEndpoint = endpoints.find((e) => e.url.includes('legacy-text'));
  assert.equal(legacyEndpoint.hasJsonResponse, false, 'unparseable body has nothing to store as JSON');

  window.localStorage.setItem('auth_token', 'super-secret-value');
  window.localStorage.setItem('theme', 'dark');

  const button = window.document.createElement('button');
  window.document.body.appendChild(button);
  button.click();

  history.pushState({}, '', '/new-place');

  const summary = collector.getSummary();
  assert.equal(summary.status, 'active');
  assert.ok(summary.collections.endpoints >= 1);
  assert.ok(summary.collections.localStorageItems >= 2);
  assert.ok(summary.collections.navigations >= 1, 'pushState navigation was not captured');
  assert.ok(summary.stats.totalEvents >= 1, 'click event was not captured');
  assert.ok(summary.stats.redactedItems >= 1, 'nothing was reported as redacted');
  assert.equal(summary.noise.excludedTotal, 1);

  // exportData exercises the full download pipeline (Blob + anchor click) — should not throw.
  assert.doesNotThrow(() => collector.exportData());

  collector.cleanup();
  assert.equal(typeof window.fetch, 'function', 'cleanup should leave fetch callable, not undefined');
});
