import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_EVENT_KINDS,
  isPageEventKind,
  validatePageEventEnvelope
} from '../../dist/shared/evidence.js';

function event(overrides = {}) {
  return {
    kind: 'network-request',
    sequence: 1,
    generation: 2,
    runId: 'run_example_123',
    wallTime: 1000,
    eventId: 'evt_1',
    documentId: 'doc_1',
    data: {
      url: 'https://example.test/api'
    },
    ...overrides
  };
}

test('shared page-event kinds form the expected extension transport vocabulary', () => {
  assert.equal(
    PAGE_EVENT_KINDS.length,
    23
  );

  assert.equal(
    Object.isFrozen(PAGE_EVENT_KINDS),
    true
  );

  assert.equal(
    new Set(PAGE_EVENT_KINDS).size,
    PAGE_EVENT_KINDS.length
  );

  assert.equal(
    isPageEventKind('network-request'),
    true
  );

  assert.equal(
    isPageEventKind('cdp-event'),
    false
  );
});

test('shared page-event validator accepts every declared kind', () => {
  for (const kind of PAGE_EVENT_KINDS) {
    assert.deepEqual(
      validatePageEventEnvelope(
        event({ kind })
      ),
      { ok: true },
      kind
    );
  }
});

test('shared page-event validator preserves current envelope rejection semantics', () => {
  assert.deepEqual(
    validatePageEventEnvelope(null),
    {
      ok: false,
      error: 'Invalid page event payload.'
    }
  );

  assert.deepEqual(
    validatePageEventEnvelope(
      event({ kind: 'cdp-event' })
    ),
    {
      ok: false,
      error: 'Unsupported page event kind.'
    }
  );

  assert.deepEqual(
    validatePageEventEnvelope(
      event({ sequence: 0 })
    ),
    {
      ok: false,
      error: 'Invalid page event sequence.'
    }
  );

  assert.deepEqual(
    validatePageEventEnvelope(
      event({ generation: 0 })
    ),
    {
      ok: false,
      error: 'Invalid page event generation.'
    }
  );

  assert.deepEqual(
    validatePageEventEnvelope(
      event({ runId: '' })
    ),
    {
      ok: false,
      error: 'Invalid page event run id.'
    }
  );

  assert.deepEqual(
    validatePageEventEnvelope(
      event({ wallTime: 0 })
    ),
    {
      ok: false,
      error: 'Invalid page event time.'
    }
  );

  assert.deepEqual(
    validatePageEventEnvelope(
      event({ eventId: 'x'.repeat(161) })
    ),
    {
      ok: false,
      error: 'Invalid page event id.'
    }
  );

  assert.deepEqual(
    validatePageEventEnvelope(
      event({ documentId: 'x'.repeat(2049) })
    ),
    {
      ok: false,
      error: 'Invalid page document id.'
    }
  );

  assert.deepEqual(
    validatePageEventEnvelope(
      event({ data: [] })
    ),
    {
      ok: false,
      error: 'Invalid page event data.'
    }
  );
});
