import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// This is what actually broke on the Node 20.x CI matrix job while 22.x passed:
// Node didn't have a global `navigator` at all before v21 (not backported to the
// 20.x LTS line), and three source files referenced bare `navigator.*` with no
// existence guard. Always safe in a real browser — only Node's own runtime needs
// this simulated here, by deleting the global the same way it's simply absent
// under Node 20.
test('collector construction and exportData survive a missing global navigator', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/page' });
  const { window } = dom;
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.fetch = async () => ({
    headers: { get: () => null },
    status: 204,
    clone() {
      return this;
    },
    async text() {
      return '';
    },
  });

  global.window = window;
  global.document = window.document;
  global.Storage = window.Storage;
  global.Element = window.Element;
  global.MutationObserver = window.MutationObserver;
  global.performance = window.performance;
  global.URL = window.URL;
  global.history = window.history;

  const hadNavigator = 'navigator' in globalThis;
  const originalNavigator = globalThis.navigator;
  delete globalThis.navigator;
  assert.equal(typeof navigator, 'undefined', 'setup check: navigator should genuinely be gone here');

  let collector;
  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    assert.doesNotThrow(() => {
      collector = new ResearchCollector({ logLevel: 'error' });
    }, 'constructing the collector must not require a global navigator');

    assert.doesNotThrow(() => collector.exportData(), 'exportData must not require a global navigator either');

    const payload = collector.exportData();
    assert.equal(payload.meta.userAgent, 'unknown', 'falls back cleanly instead of throwing');
  } finally {
    collector?.cleanup();
    if (hadNavigator) {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: false,
      });
    }
  }
});
