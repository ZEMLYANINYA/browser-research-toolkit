import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Node's own test runner uses the native `performance` global to time each test
// (that's where the reported duration_ms comes from). baseGlobals() below points
// `global.performance` at a jsdom window's implementation for the duration of a
// test — if it isn't put back afterward, the *next* test's reporting calls
// performance.now() against a jsdom realm that has nothing to do with it, which
// is what caused "Maximum call stack size exceeded" failures here. Restored in a
// finally block in every test, so it happens even if an assertion throws first.
const nativePerformance = globalThis.performance;

function baseGlobals(window) {
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
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
}

test('password/email/tel fields never get keys or values recorded, regardless of content', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/login' });
  const { window } = dom;
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
  baseGlobals(window);

  let collector;
  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    const passwordInput = window.document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.value = 'hunter2';
    window.document.body.appendChild(passwordInput);

    passwordInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    passwordInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    const summary = collector.getSummary();
    assert.ok(summary.stats.totalEvents >= 2, 'events on the password field should still be counted, just not with their content');

    // Reach into the raw export to confirm no plaintext password/keystroke leaked anywhere.
    const payload = JSON.stringify(collector.exportData());
    assert.ok(!payload.includes('hunter2'), 'password value leaked into the export');
    assert.ok(!payload.includes('"key":"h"'), 'individual keystroke on a password field leaked into the export');
  } finally {
    collector?.cleanup();
    global.performance = nativePerformance;
  }
});

test('XHR setRequestHeader is captured (was previously invisible to the collector)', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/page' });
  const { window } = dom;
  baseGlobals(window);
  window.fetch = async () => ({ headers: { get: () => null }, status: 204, clone() { return this; }, async text() { return ''; } });

  let collector;
  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    await new Promise((resolve) => {
      const xhr = new window.XMLHttpRequest();
      xhr.open('GET', 'https://example.test/api/whoami');
      xhr.setRequestHeader('X-Custom-Trace', 'trace-id-123');
      xhr.setRequestHeader('Authorization', 'Bearer secret-token');
      xhr.addEventListener('loadend', resolve);
      xhr.addEventListener('error', resolve);
      try {
        xhr.send();
      } catch {
        resolve();
      }
    });

    const requests = collector.exportData().networkRequests;
    const req = requests.find((r) => r.url.includes('whoami'));
    assert.ok(req, 'expected the XHR request to be recorded');
    assert.ok(req.headers, 'setRequestHeader should have populated requestData.headers');
    assert.equal(req.headers['X-Custom-Trace'], 'trace-id-123');
    assert.equal(req.headers['Authorization'], '[REDACTED]', 'auth-looking header names should still be redacted');
  } finally {
    collector?.cleanup();
    global.performance = nativePerformance;
  }
});

test('XHR constructor preserves native surface for Dynatrace-style prototype calls', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/page',
  });
  const { window } = dom;
  baseGlobals(window);

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

  const OriginalXHR = window.XMLHttpRequest;
  const originalPrototype = OriginalXHR.prototype;
  const originalConstants = {
    UNSENT: OriginalXHR.UNSENT,
    OPENED: OriginalXHR.OPENED,
    HEADERS_RECEIVED: OriginalXHR.HEADERS_RECEIVED,
    LOADING: OriginalXHR.LOADING,
    DONE: OriginalXHR.DONE,
  };

  let collector;
  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    assert.equal(
      window.XMLHttpRequest.prototype,
      originalPrototype,
      'replacement constructor should preserve the native XMLHttpRequest prototype',
    );

    assert.equal(
      typeof window.XMLHttpRequest.prototype.open,
      'function',
      'XMLHttpRequest.prototype.open should remain callable',
    );

    for (const [name, value] of Object.entries(originalConstants)) {
      assert.equal(
        window.XMLHttpRequest[name],
        value,
        'XMLHttpRequest.' + name + ' should preserve its native value',
      );
    }

    const xhr = new window.XMLHttpRequest();

    assert.ok(
      xhr instanceof OriginalXHR,
      'new XMLHttpRequest() should return a real native XHR instance',
    );

    assert.ok(
      xhr instanceof window.XMLHttpRequest,
      'new XMLHttpRequest() should satisfy instanceof against the installed constructor',
    );

    assert.doesNotThrow(
      () => {
        window.XMLHttpRequest.prototype.open.apply(xhr, [
          'GET',
          'https://example.test/api/dynatrace-style',
        ]);
      },
      'Dynatrace-style XMLHttpRequest.prototype.open.apply(xhr, args) should work',
    );

    window.XMLHttpRequest.prototype.setRequestHeader.apply(xhr, [
      'X-Prototype-Trace',
      'prototype-123',
    ]);

    try {
      window.XMLHttpRequest.prototype.send.apply(xhr, [null]);
      xhr.abort();
    } catch {
      // jsdom may reject the synthetic network request; capture is synchronous.
    }

    const requests = collector.exportData().networkRequests;
    const recorded = requests.find((request) =>
      request.url.includes('/api/dynatrace-style'),
    );

    assert.ok(
      recorded,
      'prototype-based XHR calls should still be captured',
    );

    assert.equal(
      recorded.method,
      'GET',
      'prototype-based open should preserve the request method',
    );

    assert.equal(
      recorded.headers?.['X-Prototype-Trace'],
      'prototype-123',
      'prototype-based setRequestHeader should remain observable',
    );
  } finally {
    collector?.cleanup();

    assert.equal(
      window.XMLHttpRequest,
      OriginalXHR,
      'cleanup should restore the exact original XMLHttpRequest constructor',
    );

    global.performance = nativePerformance;
  }
});

test('XHR per-send listeners are removed before a reused instance starts another request', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/page',
  });
  const { window } = dom;
  baseGlobals(window);

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

  const nativeSend = window.XMLHttpRequest.prototype.send;

  // Avoid a real network request. The interceptor captures this method during
  // installation, while the test manually dispatches terminal XHR events.
  window.XMLHttpRequest.prototype.send = function () {};

  let collector;
  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    const xhr = new window.XMLHttpRequest();

    const nativeAddEventListener = xhr.addEventListener.bind(xhr);
    const nativeRemoveEventListener = xhr.removeEventListener.bind(xhr);

    const activeListeners = new Map();

    xhr.addEventListener = ((type, listener, options) => {
      if (['load', 'error', 'abort', 'timeout'].includes(type)) {
        if (!activeListeners.has(type)) {
          activeListeners.set(type, new Set());
        }
        activeListeners.get(type).add(listener);
      }

      return nativeAddEventListener(type, listener, options);
    });

    xhr.removeEventListener = ((type, listener, options) => {
      activeListeners.get(type)?.delete(listener);
      return nativeRemoveEventListener(type, listener, options);
    });

    xhr.open('GET', 'https://example.test/api/reuse-first');
    xhr.send();

    assert.equal(
      activeListeners.get('load')?.size ?? 0,
      1,
      'first send should install one load listener',
    );

    xhr.dispatchEvent(new window.Event('error'));

    assert.equal(
      activeListeners.get('load')?.size ?? 0,
      0,
      'terminal error should remove the stale load listener',
    );

    assert.equal(
      activeListeners.get('error')?.size ?? 0,
      0,
      'terminal error should remove its own error listener',
    );

    xhr.open('GET', 'https://example.test/api/reuse-second');
    xhr.send();

    assert.equal(
      activeListeners.get('load')?.size ?? 0,
      1,
      'reusing the XHR should install only one fresh load listener',
    );

    xhr.dispatchEvent(new window.Event('abort'));

    assert.equal(
      activeListeners.get('load')?.size ?? 0,
      0,
      'abort should remove listeners belonging to the aborted request',
    );
  } finally {
    collector?.cleanup();
    window.XMLHttpRequest.prototype.send = nativeSend;
    global.performance = nativePerformance;
  }
});

test('XHR completion survives reopen from an earlier load listener', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/page',
  });
  const { window } = dom;
  baseGlobals(window);

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

  const nativeSend = window.XMLHttpRequest.prototype.send;

  // Keep the test local and deterministic. The interceptor captures this
  // stand-in during installation; completion is dispatched manually below.
  window.XMLHttpRequest.prototype.send = function () {};

  let collector;
  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    const xhr = new window.XMLHttpRequest();

    let syntheticReadyState = window.XMLHttpRequest.UNSENT;
    let syntheticStatus = 0;
    let syntheticStatusText = '';

    Object.defineProperty(xhr, 'readyState', {
      configurable: true,
      get: () => syntheticReadyState,
    });

    Object.defineProperty(xhr, 'status', {
      configurable: true,
      get: () => syntheticStatus,
    });

    Object.defineProperty(xhr, 'statusText', {
      configurable: true,
      get: () => syntheticStatusText,
    });

    // Registered before send(), therefore this application listener runs
    // before the collector's per-send load listener.
    xhr.addEventListener('load', () => {
      xhr.open('GET', 'https://example.test/api/reopen-second');
      syntheticReadyState = window.XMLHttpRequest.OPENED;
      syntheticStatus = 0;
      syntheticStatusText = '';
    });

    xhr.open('GET', 'https://example.test/api/reopen-first');
    syntheticReadyState = window.XMLHttpRequest.OPENED;

    xhr.send();

    syntheticReadyState = window.XMLHttpRequest.DONE;
    syntheticStatus = 204;
    syntheticStatusText = 'No Content';

    xhr.dispatchEvent(new window.Event('load'));

    const requests = collector.exportData().networkRequests;
    const first = requests.find((request) =>
      request.url.includes('/api/reopen-first'),
    );

    assert.ok(first, 'first request should have been recorded');

    assert.equal(
      first.status,
      204,
      'completed request should retain response status even if an earlier listener reopens the XHR',
    );

    assert.equal(
      first.statusText,
      'No Content',
      'completed request should retain response status text before reuse',
    );
  } finally {
    collector?.cleanup();
    window.XMLHttpRequest.prototype.send = nativeSend;
    global.performance = nativePerformance;
  }
});

test('XHR cleanup preserves prototype wrappers installed after the collector', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/page',
  });

  const { window } = dom;
  baseGlobals(window);

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

  const OriginalXHR = window.XMLHttpRequest;
  const proto = OriginalXHR.prototype;

  const nativeOpen = proto.open;
  const nativeSetRequestHeader = proto.setRequestHeader;
  const nativeSend = proto.send;

  let collector;

  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    const brtOpen = proto.open;
    const brtSetRequestHeader = proto.setRequestHeader;
    const brtSend = proto.send;

    const laterOpen = function (...args) {
      return Reflect.apply(brtOpen, this, args);
    };

    const laterSetRequestHeader = function (...args) {
      return Reflect.apply(brtSetRequestHeader, this, args);
    };

    const laterSend = function (...args) {
      return Reflect.apply(brtSend, this, args);
    };

    proto.open = laterOpen;
    proto.setRequestHeader = laterSetRequestHeader;
    proto.send = laterSend;

    const laterConstructor = function LaterXMLHttpRequest() {};
    window.XMLHttpRequest = laterConstructor;

    collector.cleanup();
    collector = null;

    assert.equal(
      window.XMLHttpRequest,
      laterConstructor,
      'cleanup must not overwrite a constructor installed after BRT',
    );

    assert.equal(
      proto.open,
      laterOpen,
      'cleanup must not overwrite an open wrapper installed after BRT',
    );

    assert.equal(
      proto.setRequestHeader,
      laterSetRequestHeader,
      'cleanup must not overwrite a setRequestHeader wrapper installed after BRT',
    );

    assert.equal(
      proto.send,
      laterSend,
      'cleanup must not overwrite a send wrapper installed after BRT',
    );
  } finally {
    collector?.cleanup();

    window.XMLHttpRequest = OriginalXHR;
    proto.open = nativeOpen;
    proto.setRequestHeader = nativeSetRequestHeader;
    proto.send = nativeSend;

    global.performance = nativePerformance;
  }
});

test('fetch(new Request(url, opts)) preserves method — single-argument form used to lose it', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/page' });
  const { window } = dom;
  baseGlobals(window);

  let capturedMethod = null;
  window.fetch = async (input) => {
    capturedMethod = input instanceof Request ? input.method : 'GET';
    return { headers: { get: () => null }, status: 204, clone() { return this; }, async text() { return ''; } };
  };

  let collector;
  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    // jsdom doesn't implement window.Request/fetch at all — using Node's own
    // native Request here (the same global the source code's `instanceof Request`
    // check reads) is the correct stand-in, not a workaround.
    const req = new Request('https://example.test/api/data', { method: 'POST' });
    await window.fetch(req);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(capturedMethod, 'POST', 'sanity check: the underlying fetch mock did receive POST');

    const requests = collector.exportData().networkRequests;
    const recorded = requests.find((r) => r.url.includes('/api/data'));
    assert.ok(recorded, 'expected the Request-object fetch call to be recorded');
    assert.equal(recorded.method, 'POST', 'method from a single-argument Request object should not be lost');
  } finally {
    collector?.cleanup();
    global.performance = nativePerformance;
  }
});
