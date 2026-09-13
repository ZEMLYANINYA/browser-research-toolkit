import test from 'node:test';
import assert from 'node:assert/strict';

import { timelineLabel } from '../src/timeline-label.js';

test('timelineLabel formats network evidence', () => {
  assert.equal(
    timelineLabel({
      kind: 'network-request',
      data: { transport: 'xhr', method: 'POST', url: '/api/items' }
    }),
    'xhr POST /api/items'
  );

  assert.equal(
    timelineLabel({
      kind: 'network-response',
      data: { transport: 'fetch', status: 200, url: '/api/items' }
    }),
    'fetch response 200 /api/items'
  );
});

test('timelineLabel formats form navigation source and DOM evidence', () => {
  assert.equal(
    timelineLabel({
      kind: 'form-submit',
      data: { method: 'POST', action: '/search', trigger: 'requestSubmit' }
    }),
    'POST form /search · requestSubmit'
  );

  assert.equal(
    timelineLabel({
      kind: 'dom-event',
      data: { type: 'click', target: { selectorHint: '#submit' } }
    }),
    'click #submit'
  );

  assert.equal(
    timelineLabel({ kind: 'source-inline', data: {} }),
    'inline script'
  );
});

test('timelineLabel formats timer and connection evidence', () => {
  assert.equal(
    timelineLabel({
      kind: 'timer-schedule',
      data: {
        timerType: 'timeout',
        delay: 500,
        callbackKeywords: ['refresh', 'poll']
      }
    }),
    'timeout 500ms · refresh,poll'
  );

  assert.equal(
    timelineLabel({
      kind: 'connection-lifecycle',
      data: { transport: 'websocket', state: 'open', url: 'wss://example.test' }
    }),
    'websocket open wss://example.test'
  );
});

test('timelineLabel uses CDP URL precedence without changing evidence', () => {
  assert.equal(
    timelineLabel({
      kind: 'cdp-event',
      data: {
        method: 'Network.requestWillBeSent',
        request: { url: 'https://example.test/request' },
        response: { url: 'https://example.test/response' }
      }
    }),
    'CDP Network.requestWillBeSent · https://example.test/request'
  );
});

test('timelineLabel falls back to the event kind', () => {
  assert.equal(
    timelineLabel({ kind: 'custom-event', data: {} }),
    'custom-event'
  );
});
