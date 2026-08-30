import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_EVENT_KINDS, validatePageEventPayload, validateRuntimeMessage } from '../src/protocol.js';

function event(overrides = {}) {
  return {
    kind: 'network-request',
    sequence: 1,
    generation: 2,
    runId: 'run_example_123',
    wallTime: Date.now(),
    eventId: 'evt_1',
    documentId: 'https://example.test/|1',
    data: { url: 'https://example.test/api' },
    ...overrides
  };
}

test('every declared page event kind validates with a valid envelope', () => {
  for (const kind of PAGE_EVENT_KINDS) assert.equal(validatePageEventPayload(event({ kind })).ok, true, kind);
});

test('page events require a current run id and generation-shaped envelope', () => {
  assert.equal(validatePageEventPayload(event({ runId: null })).ok, false);
  assert.equal(validatePageEventPayload(event({ generation: 0 })).ok, false);
  assert.equal(validatePageEventPayload(event({ sequence: 0 })).ok, false);
});

test('unknown page event kinds are rejected', () => {
  assert.equal(validatePageEventPayload(event({ kind: 'cdp-event' })).ok, false);
  assert.equal(validatePageEventPayload(event({ kind: 'exploit-result' })).ok, false);
});

test('runtime validation delegates BRT_PAGE_EVENT to page event validation', () => {
  assert.equal(validateRuntimeMessage({ type: 'BRT_PAGE_EVENT', payload: event() }).ok, true);
  assert.equal(validateRuntimeMessage({ type: 'BRT_PAGE_EVENT', payload: event({ runId: '' }) }).ok, false);
});
