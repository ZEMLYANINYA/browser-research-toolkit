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

test('XHR capture survives a preinstalled constructor wrapper with an unrelated prototype', async () => {
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

  const NativeXHR = window.XMLHttpRequest;
  const nativeProto = NativeXHR.prototype;
  const nativeSend = nativeProto.send;

  // Avoid a real network request.
  nativeProto.send = function () {};

  function PreinstalledXHR() {
    return new NativeXHR();
  }

  // Model instrumentation that exposes its own constructor prototype while
  // returning a real native XMLHttpRequest instance.
  PreinstalledXHR.prototype = {
    constructor: PreinstalledXHR,
  };

  Object.setPrototypeOf(PreinstalledXHR, NativeXHR);

  window.XMLHttpRequest = PreinstalledXHR;

  let collector;

  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    const xhr = new window.XMLHttpRequest();

    assert.ok(
      xhr instanceof NativeXHR,
      'preinstalled wrapper should return a real native XHR instance',
    );

    xhr.open(
      'GET',
      'https://example.test/api/preinstalled-constructor-wrapper',
    );

    xhr.send();

    const requests = collector.exportData().networkRequests;

    const recorded = requests.find((request) =>
      request.url.includes('/api/preinstalled-constructor-wrapper'),
    );

    assert.ok(
      recorded,
      'XHR returned by a preinstalled constructor wrapper should still be captured',
    );

    assert.equal(recorded.method, 'GET');
  } finally {
    collector?.cleanup();

    window.XMLHttpRequest = NativeXHR;
    nativeProto.send = nativeSend;

    global.performance = nativePerformance;
  }
});

test('XHR retries from error or timeout are not finalized as successful loads', async () => {
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

  // Keep the test deterministic. Terminal events are dispatched manually.
  window.XMLHttpRequest.prototype.send = function () {};

  let collector;

  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    for (const terminalEvent of ['error', 'timeout']) {
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

      // This application handler is registered before send(), so it runs
      // before BRT's per-send terminal listener and immediately retries.
      xhr.addEventListener(terminalEvent, () => {
        xhr.open(
          'GET',
          'https://example.test/api/retry-' +
            terminalEvent +
            '-second',
        );

        syntheticReadyState = window.XMLHttpRequest.OPENED;
        syntheticStatus = 0;
        syntheticStatusText = '';
      });

      xhr.open(
        'GET',
        'https://example.test/api/retry-' +
          terminalEvent +
          '-first',
      );

      syntheticReadyState = window.XMLHttpRequest.OPENED;

      xhr.send();

      syntheticReadyState = window.XMLHttpRequest.DONE;
      syntheticStatus = 0;
      syntheticStatusText = '';

      xhr.dispatchEvent(new window.Event(terminalEvent));

      const requests = collector.exportData().networkRequests;

      const first = requests.find((request) =>
        request.url.includes(
          '/api/retry-' + terminalEvent + '-first',
        ),
      );

      assert.ok(
        first,
        terminalEvent + ' request should have been recorded',
      );

      assert.equal(
        first.responseType,
        undefined,
        terminalEvent +
          ' retry must not analyze the failed request as a successful response',
      );
    }

    const errors = collector.getErrors();

    assert.ok(
      errors.some((entry) => entry.type === 'XHR Error'),
      'error retry should still reach the collector XHR error handler',
    );
  } finally {
    collector?.cleanup();

    window.XMLHttpRequest.prototype.send = nativeSend;
    global.performance = nativePerformance;
  }
});

test('XHR duplicate send preserves the first in-flight request lifecycle', async () => {
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

  const proto = window.XMLHttpRequest.prototype;
  const nativeSend = proto.send;

  let sendCalls = 0;

  // Model native XHR behavior:
  // the first send starts successfully, while a second send on the same
  // in-flight request throws InvalidStateError.
  proto.send = function () {
    sendCalls++;

    if (sendCalls > 1) {
      throw new window.DOMException(
        'The object is in an invalid state.',
        'InvalidStateError',
      );
    }
  };

  let collector;

  try {
    const { ResearchCollector } = await import('../../dist/collector.js');
    collector = new ResearchCollector({ logLevel: 'error' });

    const xhr = new window.XMLHttpRequest();

    let syntheticStatus = 0;
    let syntheticStatusText = '';

    Object.defineProperty(xhr, 'status', {
      configurable: true,
      get: () => syntheticStatus,
    });

    Object.defineProperty(xhr, 'statusText', {
      configurable: true,
      get: () => syntheticStatusText,
    });

    xhr.open(
      'GET',
      'https://example.test/api/duplicate-send',
    );

    xhr.send();

    assert.throws(
      () => xhr.send(),
      (error) => error?.name === 'InvalidStateError',
      'duplicate send should surface the native InvalidStateError',
    );

    syntheticStatus = 200;
    syntheticStatusText = 'OK';

    xhr.dispatchEvent(new window.Event('load'));

    const requests = collector.exportData().networkRequests;

    const matching = requests.filter((request) =>
      request.url.includes('/api/duplicate-send'),
    );

    assert.equal(
      matching.length,
      1,
      'rejected duplicate send must not record the request twice',
    );

    assert.equal(
      matching[0].status,
      200,
      'first in-flight request must retain its completion listener',
    );

    assert.equal(
      matching[0].statusText,
      'OK',
      'first in-flight request must retain response metadata',
    );
  } finally {
    collector?.cleanup();

    proto.send = nativeSend;
    global.performance = nativePerformance;
  }
});

test('XHR completion survives reopen from DONE readystatechange', async () => {
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

  const proto = window.XMLHttpRequest.prototype;
  const nativeSend = proto.send;

  // Keep this local and deterministic. Completion events are dispatched
  // manually so the ordering is entirely under the test's control.
  proto.send = function () {};

  let collector;

  try {
    const { ResearchCollector } =
      await import('../../dist/collector.js');

    collector = new ResearchCollector({
      logLevel: 'error',
    });

    const xhr = new window.XMLHttpRequest();

    let syntheticReadyState =
      window.XMLHttpRequest.UNSENT;

    let syntheticStatus = 0;
    let syntheticStatusText = '';
    let reopened = false;

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

    xhr.addEventListener('readystatechange', () => {
      if (
        reopened ||
        syntheticReadyState !==
          window.XMLHttpRequest.DONE
      ) {
        return;
      }

      reopened = true;

      xhr.open(
        'GET',
        'https://example.test/api/readystatechange-second',
      );

      // open() has now reset the XHR for the replacement request.
      syntheticReadyState =
        window.XMLHttpRequest.OPENED;

      syntheticStatus = 0;
      syntheticStatusText = '';
    });

    xhr.open(
      'GET',
      'https://example.test/api/readystatechange-first',
    );

    syntheticReadyState =
      window.XMLHttpRequest.OPENED;

    xhr.send();

    syntheticReadyState =
      window.XMLHttpRequest.DONE;

    syntheticStatus = 200;
    syntheticStatusText = 'OK';

    // readystatechange(DONE) occurs before load.
    xhr.dispatchEvent(
      new window.Event('readystatechange'),
    );

    // The old request's load is now attempted after the application
    // already reopened the XHR.
    xhr.dispatchEvent(
      new window.Event('load'),
    );

    const requests =
      collector.exportData().networkRequests;

    const first = requests.find((request) =>
      request.url.includes(
        '/api/readystatechange-first',
      ),
    );

    assert.ok(
      first,
      'first request should have been recorded',
    );

    assert.equal(
      first.status,
      200,
      'DONE request must retain status when reopened from readystatechange before load',
    );

    assert.equal(
      first.statusText,
      'OK',
      'DONE request must retain status text when reopened from readystatechange before load',
    );
  } finally {
    collector?.cleanup();

    proto.send = nativeSend;
    global.performance = nativePerformance;
  }
});

test('XHR rejected replacement open preserves the prior in-flight lifecycle', async () => {
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

  const proto = window.XMLHttpRequest.prototype;
  const nativeOpen = proto.open;
  const nativeSend = proto.send;

  proto.open = function (method, url, ...rest) {
    if (String(method).toUpperCase() === 'CONNECT') {
      throw new window.DOMException(
        'Forbidden XHR method',
        'SecurityError',
      );
    }

    return Reflect.apply(
      nativeOpen,
      this,
      [method, url, ...rest],
    );
  };

  // Keep the first request pending until we dispatch load manually.
  proto.send = function () {};

  let collector;

  try {
    const { ResearchCollector } =
      await import('../../dist/collector.js');

    collector = new ResearchCollector({
      logLevel: 'error',
    });

    const xhr = new window.XMLHttpRequest();

    let syntheticStatus = 0;
    let syntheticStatusText = '';

    Object.defineProperty(xhr, 'status', {
      configurable: true,
      get: () => syntheticStatus,
    });

    Object.defineProperty(xhr, 'statusText', {
      configurable: true,
      get: () => syntheticStatusText,
    });

    xhr.open(
      'GET',
      'https://example.test/api/open-first',
    );

    xhr.send();

    assert.throws(
      () =>
        xhr.open(
          'CONNECT',
          'https://example.test/api/open-rejected',
        ),
      (error) => error?.name === 'SecurityError',
      'replacement open should surface the native validation error',
    );

    syntheticStatus = 200;
    syntheticStatusText = 'OK';

    xhr.dispatchEvent(new window.Event('load'));

    const requests =
      collector.exportData().networkRequests;

    const first = requests.find((request) =>
      request.url.includes('/api/open-first'),
    );

    assert.ok(
      first,
      'first request should remain recorded',
    );

    assert.equal(
      first.status,
      200,
      'rejected replacement open must not detach the first request lifecycle',
    );

    assert.equal(
      first.statusText,
      'OK',
      'first request response metadata must survive a rejected replacement open',
    );
  } finally {
    collector?.cleanup();

    proto.open = nativeOpen;
    proto.send = nativeSend;
    global.performance = nativePerformance;
  }
});

test('XHR capture survives preinstalled own methods with cached delegates', async () => {
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

  const NativeXHR = window.XMLHttpRequest;
  const proto = NativeXHR.prototype;

  const cachedOpen = proto.open;
  const cachedSetRequestHeader = proto.setRequestHeader;
  const trulyNativeSend = proto.send;

  // Stand-in cached before BRT installs. Instance send() will retain this
  // reference even after BRT later patches the native prototype.
  proto.send = function () {};
  const cachedSend = proto.send;

  function PreinstalledXHR() {
    const xhr = new NativeXHR();

    Object.defineProperties(xhr, {
      open: {
        configurable: true,
        writable: true,
        value: function (...args) {
          return Reflect.apply(
            cachedOpen,
            this,
            args,
          );
        },
      },

      setRequestHeader: {
        configurable: true,
        writable: true,
        value: function (...args) {
          return Reflect.apply(
            cachedSetRequestHeader,
            this,
            args,
          );
        },
      },

      send: {
        configurable: true,
        writable: true,
        value: function (...args) {
          return Reflect.apply(
            cachedSend,
            this,
            args,
          );
        },
      },
    });

    return xhr;
  }

  PreinstalledXHR.prototype = NativeXHR.prototype;
  Object.setPrototypeOf(PreinstalledXHR, NativeXHR);

  window.XMLHttpRequest = PreinstalledXHR;

  let collector;

  try {
    const { ResearchCollector } =
      await import('../../dist/collector.js');

    collector = new ResearchCollector({
      logLevel: 'error',
    });

    const xhr = new window.XMLHttpRequest();

    assert.ok(
      Object.hasOwn(xhr, 'open'),
      'fixture should expose an own open wrapper',
    );

    assert.ok(
      Object.hasOwn(xhr, 'send'),
      'fixture should expose an own send wrapper',
    );

    xhr.open(
      'POST',
      'https://example.test/api/own-cached-wrapper',
    );

    xhr.setRequestHeader(
      'X-Own-Wrapper',
      'cached-delegate',
    );

    xhr.send('payload');

    const requests =
      collector.exportData().networkRequests;

    const recorded = requests.find((request) =>
      request.url.includes(
        '/api/own-cached-wrapper',
      ),
    );

    assert.ok(
      recorded,
      'XHR using cached own-method delegates should still be captured',
    );

    assert.equal(recorded.method, 'POST');

    assert.equal(
      recorded.headers?.['X-Own-Wrapper'],
      'cached-delegate',
    );
  } finally {
    collector?.cleanup();

    window.XMLHttpRequest = NativeXHR;
    proto.send = trulyNativeSend;

    global.performance = nativePerformance;
  }
});

test('XHR capture survives a partial prototype override with a cached delegate', async () => {
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

  const NativeXHR = window.XMLHttpRequest;
  const nativeProto = NativeXHR.prototype;

  const cachedOpen = nativeProto.open;
  const trulyNativeSend = nativeProto.send;

  // Avoid real network I/O while preserving a delegate captured before BRT.
  nativeProto.send = function () {};

  const PartialPrototype =
    Object.create(nativeProto);

  Object.defineProperty(
    PartialPrototype,
    'open',
    {
      configurable: true,
      writable: true,
      value: function (...args) {
        return Reflect.apply(
          cachedOpen,
          this,
          args,
        );
      },
    },
  );

  function PreinstalledXHR() {
    const xhr = new NativeXHR();

    Object.setPrototypeOf(
      xhr,
      PartialPrototype,
    );

    return xhr;
  }

  PreinstalledXHR.prototype =
    PartialPrototype;

  Object.setPrototypeOf(
    PreinstalledXHR,
    NativeXHR,
  );

  window.XMLHttpRequest =
    PreinstalledXHR;

  let collector;

  try {
    const { ResearchCollector } =
      await import('../../dist/collector.js');

    collector = new ResearchCollector({
      logLevel: 'error',
    });

    const xhr =
      new window.XMLHttpRequest();

    assert.equal(
      Object.getPrototypeOf(xhr),
      PartialPrototype,
      'fixture should return an XHR through the partial override prototype',
    );

    xhr.open(
      'POST',
      'https://example.test/api/partial-prototype-wrapper',
    );

    xhr.setRequestHeader(
      'X-Partial-Wrapper',
      'cached-open',
    );

    xhr.send('payload');

    const requests =
      collector.exportData().networkRequests;

    const recorded = requests.find(
      (request) =>
        request.url.includes(
          '/api/partial-prototype-wrapper',
        ),
    );

    assert.ok(
      recorded,
      'XHR using a cached partial prototype override should still be captured',
    );

    assert.equal(
      recorded.method,
      'POST',
    );

    assert.equal(
      recorded.headers?.['X-Partial-Wrapper'],
      'cached-open',
    );
  } finally {
    collector?.cleanup();

    window.XMLHttpRequest =
      NativeXHR;

    nativeProto.send =
      trulyNativeSend;

    global.performance =
      nativePerformance;
  }
});

test('XHR successful zero-status completion survives reopen from DONE readystatechange', async () => {
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

  const proto = window.XMLHttpRequest.prototype;
  const nativeSend = proto.send;

  proto.send = function () {};

  let collector;

  try {
    const { ResearchCollector } =
      await import('../../dist/collector.js');

    collector = new ResearchCollector({
      logLevel: 'error',
    });

    const xhr = new window.XMLHttpRequest();

    let syntheticReadyState =
      window.XMLHttpRequest.UNSENT;

    let syntheticStatus = 0;
    let syntheticStatusText = '';

    let syntheticResponseUrl =
      'file:///tmp/zero-status-first.json';

    let reopened = false;

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

    Object.defineProperty(xhr, 'responseURL', {
      configurable: true,
      get: () => syntheticResponseUrl,
    });

    xhr.addEventListener('readystatechange', () => {
      if (
        reopened ||
        syntheticReadyState !==
          window.XMLHttpRequest.DONE
      ) {
        return;
      }

      reopened = true;

      xhr.open(
        'GET',
        'https://example.test/api/zero-status-second',
      );

      syntheticReadyState =
        window.XMLHttpRequest.OPENED;

      syntheticStatus = 0;
      syntheticStatusText = '';
      syntheticResponseUrl = '';
    });

    xhr.open(
      'GET',
      'file:///tmp/zero-status-first.json',
    );

    syntheticReadyState =
      window.XMLHttpRequest.OPENED;

    xhr.send();

    syntheticReadyState =
      window.XMLHttpRequest.DONE;

    syntheticStatus = 0;
    syntheticStatusText = '';
    syntheticResponseUrl =
      'file:///tmp/zero-status-first.json';

    xhr.dispatchEvent(
      new window.Event('readystatechange'),
    );

    const requests =
      collector.exportData().networkRequests;

    const first = requests.find((request) =>
      request.url.includes(
        'zero-status-first.json',
      ),
    );

    assert.ok(
      first,
      'successful zero-status request should be recorded',
    );

    assert.equal(
      first.status,
      0,
      'successful status-0 response must be finalized before reopen',
    );
  } finally {
    collector?.cleanup();

    proto.send = nativeSend;
    global.performance = nativePerformance;
  }
});

test('XHR capture survives prototype calls through an unrelated constructor prototype', async () => {
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

  const NativeXHR = window.XMLHttpRequest;
  const nativeProto = NativeXHR.prototype;

  const cachedOpen = nativeProto.open;
  const trulyNativeSend = nativeProto.send;

  // Prevent real network I/O while keeping a delegate cached before BRT.
  nativeProto.send = function () {};

  const unrelatedPrototype = {
    open(method, url, ...rest) {
      return Reflect.apply(
        cachedOpen,
        this,
        [method, url, ...rest],
      );
    },
  };

  function PreinstalledXHR() {
    return new NativeXHR();
  }

  PreinstalledXHR.prototype =
    unrelatedPrototype;

  Object.setPrototypeOf(
    PreinstalledXHR,
    NativeXHR,
  );

  window.XMLHttpRequest =
    PreinstalledXHR;

  let collector;

  try {
    const { ResearchCollector } =
      await import('../../dist/collector.js');

    collector = new ResearchCollector({
      logLevel: 'error',
    });

    const xhr =
      new window.XMLHttpRequest();

    window.XMLHttpRequest.prototype.open.apply(
      xhr,
      [
        'POST',
        'https://example.test/api/unrelated-constructor-prototype',
      ],
    );

    xhr.send();

    const requests =
      collector.exportData().networkRequests;

    const recorded = requests.find(
      (request) =>
        request.url.includes(
          '/api/unrelated-constructor-prototype',
        ),
    );

    assert.ok(
      recorded,
      'prototype call through the exported unrelated constructor prototype should be captured',
    );

    assert.equal(
      recorded.method,
      'POST',
    );
  } finally {
    collector?.cleanup();

    window.XMLHttpRequest =
      NativeXHR;

    nativeProto.send =
      trulyNativeSend;

    global.performance =
      nativePerformance;
  }
});

test('XHR cleanup restores own methods when WeakRef is unavailable', async () => {
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

  const NativeXHR = window.XMLHttpRequest;
  const nativeProto = NativeXHR.prototype;

  const cachedOpen = nativeProto.open;
  const cachedSetRequestHeader =
    nativeProto.setRequestHeader;

  const trulyNativeSend =
    nativeProto.send;

  nativeProto.send = function () {};

  const cachedSend = nativeProto.send;

  let lastOwnOpen;
  let lastOwnSetRequestHeader;
  let lastOwnSend;

  function PreinstalledXHR() {
    const xhr = new NativeXHR();

    lastOwnOpen = function (...args) {
      return Reflect.apply(
        cachedOpen,
        this,
        args,
      );
    };

    lastOwnSetRequestHeader =
      function (...args) {
        return Reflect.apply(
          cachedSetRequestHeader,
          this,
          args,
        );
      };

    lastOwnSend = function (...args) {
      return Reflect.apply(
        cachedSend,
        this,
        args,
      );
    };

    Object.defineProperties(xhr, {
      open: {
        configurable: true,
        writable: true,
        value: lastOwnOpen,
      },

      setRequestHeader: {
        configurable: true,
        writable: true,
        value:
          lastOwnSetRequestHeader,
      },

      send: {
        configurable: true,
        writable: true,
        value: lastOwnSend,
      },
    });

    return xhr;
  }

  PreinstalledXHR.prototype =
    NativeXHR.prototype;

  Object.setPrototypeOf(
    PreinstalledXHR,
    NativeXHR,
  );

  window.XMLHttpRequest =
    PreinstalledXHR;

  const weakRefDescriptor =
    Object.getOwnPropertyDescriptor(
      globalThis,
      'WeakRef',
    );

  Object.defineProperty(
    globalThis,
    'WeakRef',
    {
      configurable: true,
      writable: true,
      value: undefined,
    },
  );

  let collector;

  try {
    const { ResearchCollector } =
      await import('../../dist/collector.js');

    collector = new ResearchCollector({
      logLevel: 'error',
    });

    const xhr =
      new window.XMLHttpRequest();

    assert.notEqual(
      xhr.open,
      lastOwnOpen,
      'fixture should confirm BRT wrapped the own open method',
    );

    collector.cleanup();
    collector = null;

    assert.equal(
      xhr.open,
      lastOwnOpen,
      'cleanup must restore the original own open method without WeakRef',
    );

    assert.equal(
      xhr.setRequestHeader,
      lastOwnSetRequestHeader,
      'cleanup must restore the original own setRequestHeader method without WeakRef',
    );

    assert.equal(
      xhr.send,
      lastOwnSend,
      'cleanup must restore the original own send method without WeakRef',
    );
  } finally {
    collector?.cleanup();

    window.XMLHttpRequest =
      NativeXHR;

    nativeProto.send =
      trulyNativeSend;

    if (weakRefDescriptor) {
      Object.defineProperty(
        globalThis,
        'WeakRef',
        weakRefDescriptor,
      );
    } else {
      delete globalThis.WeakRef;
    }

    global.performance =
      nativePerformance;
  }
});

test('XHR capture survives fresh per-instance prototypes with cached delegates', async () => {
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

  const NativeXHR = window.XMLHttpRequest;
  const nativeProto = NativeXHR.prototype;

  const cachedOpen = nativeProto.open;
  const trulyNativeSend = nativeProto.send;

  // Avoid real network I/O while retaining a delegate cached before BRT.
  nativeProto.send = function () {};

  const cachedSend = nativeProto.send;

  function PreinstalledXHR() {
    const xhr = new NativeXHR();

    /*
     * Every construction gets a different prototype. Patching a probe's
     * prototype therefore cannot affect later returned XHR instances.
     */
    const instancePrototype =
      Object.create(nativeProto);

    Object.defineProperties(
      instancePrototype,
      {
        open: {
          configurable: true,
          writable: true,
          value: function (...args) {
            return Reflect.apply(
              cachedOpen,
              this,
              args,
            );
          },
        },

        send: {
          configurable: true,
          writable: true,
          value: function (...args) {
            return Reflect.apply(
              cachedSend,
              this,
              args,
            );
          },
        },
      },
    );

    Object.setPrototypeOf(
      xhr,
      instancePrototype,
    );

    return xhr;
  }

  PreinstalledXHR.prototype =
    NativeXHR.prototype;

  Object.setPrototypeOf(
    PreinstalledXHR,
    NativeXHR,
  );

  window.XMLHttpRequest =
    PreinstalledXHR;

  let collector;

  try {
    const { ResearchCollector } =
      await import('../../dist/collector.js');

    collector = new ResearchCollector({
      logLevel: 'error',
    });

    const xhr =
      new window.XMLHttpRequest();

    xhr.open(
      'POST',
      'https://example.test/api/fresh-instance-prototype',
    );

    xhr.send('payload');

    const requests =
      collector.exportData().networkRequests;

    const recorded = requests.find(
      (request) =>
        request.url.includes(
          '/api/fresh-instance-prototype',
        ),
    );

    assert.ok(
      recorded,
      'XHR using a fresh per-instance prototype should still be captured',
    );

    assert.equal(
      recorded.method,
      'POST',
    );
  } finally {
    collector?.cleanup();

    window.XMLHttpRequest =
      NativeXHR;

    nativeProto.send =
      trulyNativeSend;

    global.performance =
      nativePerformance;
  }
});

test('XHR cleanup retires prototype hooks retained by later wrappers', async () => {
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

  const NativeXHR = window.XMLHttpRequest;
  const nativeProto = NativeXHR.prototype;

  const trulyNativeOpen =
    nativeProto.open;

  const trulyNativeSend =
    nativeProto.send;

  // Keep the test completely local.
  nativeProto.send = function () {};

  let collector;

  try {
    const { ResearchCollector } =
      await import('../../dist/collector.js');

    collector = new ResearchCollector({
      logLevel: 'error',
    });

    /*
     * Simulate instrumentation installed after BRT. These wrappers retain
     * references to the functions BRT installed.
     */
    const brtOpen =
      nativeProto.open;

    const brtSend =
      nativeProto.send;

    const laterOpen =
      function (...args) {
        return Reflect.apply(
          brtOpen,
          this,
          args,
        );
      };

    const laterSend =
      function (...args) {
        return Reflect.apply(
          brtSend,
          this,
          args,
        );
      };

    nativeProto.open =
      laterOpen;

    nativeProto.send =
      laterSend;

    collector.cleanup();

    assert.equal(
      nativeProto.open,
      laterOpen,
      'cleanup should preserve instrumentation installed after BRT',
    );

    assert.equal(
      nativeProto.send,
      laterSend,
      'cleanup should preserve the later send wrapper',
    );

    /*
     * cleanup() removed BRT. start() only toggles collector activity and
     * must not resurrect interception through wrappers that retained old
     * BRT function references.
     */
    collector.clearData();
    collector.start();

    const xhr =
      new NativeXHR();

    xhr.open(
      'GET',
      'https://example.test/api/retired-prototype-hook',
    );

    xhr.send();

    const requests =
      collector.exportData().networkRequests;

    const resurrected = requests.some(
      (request) =>
        request.url.includes(
          '/api/retired-prototype-hook',
        ),
    );

    assert.equal(
      resurrected,
      false,
      'later wrappers must not resurrect BRT capture after cleanup',
    );
  } finally {
    collector?.stop();

    window.XMLHttpRequest =
      NativeXHR;

    nativeProto.open =
      trulyNativeOpen;

    nativeProto.send =
      trulyNativeSend;

    global.performance =
      nativePerformance;
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
