import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeCdpEvent } from '../src/cdp-event-sanitizer.js';

test('request events retain metadata while sanitizing URLs', () => {
  const result = sanitizeCdpEvent(
    'Network.requestWillBeSent',
    {
      requestId: 'r1',
      loaderId: 'l1',
      documentURL: 'https://example.test/page?token=secret',
      request: {
        url: 'https://example.test/api?api_key=secret',
        method: 'POST'
      },
      type: 'XHR',
      timestamp: 10,
      initiator: {
        type: 'script',
        url: 'https://example.test/app.js?token=secret',
        lineNumber: 20
      }
    }
  );

  assert.equal(result.method, 'Network.requestWillBeSent');
  assert.equal(result.request.requestId, 'r1');
  assert.equal(result.request.method, 'POST');
  assert.doesNotMatch(result.request.url, /secret/);
  assert.doesNotMatch(result.request.documentURL, /secret/);
  assert.doesNotMatch(result.request.initiator.url, /secret/);
});

test('loading failures retain bounded diagnostic metadata', () => {
  const result = sanitizeCdpEvent(
    'Network.loadingFailed',
    {
      requestId: 'r2',
      errorText: 'x'.repeat(1000),
      canceled: true,
      blockedReason: 'inspector',
      type: 'Fetch'
    }
  );

  assert.equal(result.failure.requestId, 'r2');
  assert.equal(result.failure.canceled, true);
  assert.ok(result.failure.errorText.startsWith('x'.repeat(500)));
  assert.match(result.failure.errorText, /truncated/);
});

test('WebSocket events retain payload length without payload contents', () => {
  const result = sanitizeCdpEvent(
    'Network.webSocketFrameReceived',
    {
      requestId: 'ws1',
      timestamp: 5,
      response: {
        opcode: 1,
        payloadData: 'TOP_SECRET_PAYLOAD'
      }
    }
  );

  assert.equal(result.websocket.requestId, 'ws1');
  assert.equal(result.websocket.opcode, 1);
  assert.equal(result.websocket.payloadLength, 18);
  assert.equal('payloadData' in result.websocket, false);
});

test('unknown CDP events degrade to bounded metadata', () => {
  assert.deepEqual(
    sanitizeCdpEvent('Some.domainEvent', {
      requestId: 'r3',
      targetId: 't1',
      frameId: 'f1',
      type: 'other',
      secret: 'must-not-pass'
    }),
    {
      method: 'Some.domainEvent',
      metadata: {
        requestId: 'r3',
        targetId: 't1',
        frameId: 'f1',
        type: 'other'
      }
    }
  );
});

test('response script exception and frame events preserve only safe metadata', () => {
  const response = sanitizeCdpEvent('Network.responseReceived', {
    requestId: 'r4',
    type: 'XHR',
    response: {
      url: 'https://example.test/api?token=secret',
      status: 200,
      mimeType: 'application/json',
      encodedDataLength: 123
    }
  });

  assert.equal(response.response.status, 200);
  assert.doesNotMatch(response.response.url, /secret/);

  const script = sanitizeCdpEvent('Debugger.scriptParsed', {
    scriptId: 's1',
    url: 'https://example.test/app.js?token=secret',
    sourceMapURL: 'https://example.test/app.js.map?token=secret',
    hash: 'h'.repeat(300),
    isModule: true
  });

  assert.doesNotMatch(script.script.url, /secret/);
  assert.doesNotMatch(script.script.sourceMapURL, /secret/);
  assert.ok(script.script.hash.startsWith('h'.repeat(160)));
  assert.match(script.script.hash, /truncated/);

  const exception = sanitizeCdpEvent('Runtime.exceptionThrown', {
    timestamp: 15,
    exceptionDetails: {
      exceptionId: 9,
      text: 'boom',
      url: 'https://example.test/page?token=secret',
      lineNumber: 4,
      columnNumber: 2
    }
  });

  assert.equal(exception.exception.exceptionId, 9);
  assert.doesNotMatch(exception.exception.url, /secret/);

  const frame = sanitizeCdpEvent('Page.frameNavigated', {
    frame: {
      id: 'f2',
      parentId: 'f1',
      loaderId: 'l2',
      url: 'https://example.test/frame?token=secret',
      securityOrigin: 'https://example.test'
    }
  });

  assert.equal(frame.frame.id, 'f2');
  assert.doesNotMatch(frame.frame.url, /secret/);
});
