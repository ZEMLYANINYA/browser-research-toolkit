import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PAGE_CONTINUITY_STREAMS,
  observePageProducerSequence
} from '../src/capture-continuity.js';

function observe(continuity, producerSequence, overrides = {}) {
  return observePageProducerSequence({
    continuity,
    generation: 7,
    runId: 'run-live',
    documentId: 'doc-a',
    frameId: 0,
    producerSequence,
    observedAt: producerSequence * 100,
    ...overrides
  });
}

test('first producer event establishes a stream without reporting a gap', () => {
  const continuity = { pageStreams: [] };
  const result = observe(continuity, 1);

  assert.equal(result.status, 'new-stream');
  assert.equal(result.gap, null);
  assert.equal(continuity.pageStreams.length, 1);
  assert.equal(continuity.pageStreams[0].lastProducerSequence, 1);
});

test('consecutive producer sequence advances without a gap', () => {
  const continuity = { pageStreams: [] };
  observe(continuity, 1);
  const result = observe(continuity, 2);

  assert.equal(result.status, 'advanced');
  assert.equal(result.gap, null);
  assert.equal(continuity.pageStreams[0].lastProducerSequence, 2);
});

test('missing producer sequence range is reported exactly', () => {
  const continuity = { pageStreams: [] };
  observe(continuity, 2);
  const result = observe(continuity, 5);

  assert.equal(result.status, 'gap');
  assert.deepEqual(result.gap, {
    expectedProducerSequence: 3,
    receivedProducerSequence: 5,
    missingCount: 2,
    generation: 7,
    runId: 'run-live',
    documentId: 'doc-a',
    frameId: 0,
    provenance: 'page-observable'
  });
  assert.equal(continuity.pageStreams[0].lastProducerSequence, 5);
});

test('duplicate or out-of-order events do not rewind the durable cursor', () => {
  const continuity = { pageStreams: [] };
  observe(continuity, 5);
  const result = observe(continuity, 4);

  assert.equal(result.status, 'duplicate-or-out-of-order');
  assert.equal(result.gap, null);
  assert.equal(continuity.pageStreams[0].lastProducerSequence, 5);
});

test('new document starts an independent producer stream', () => {
  const continuity = { pageStreams: [] };
  observe(continuity, 9);

  const result = observe(continuity, 1, { documentId: 'doc-b' });

  assert.equal(result.status, 'new-stream');
  assert.equal(result.gap, null);
  assert.equal(continuity.pageStreams.length, 2);
});

test('new generation starts an independent producer stream', () => {
  const continuity = { pageStreams: [] };
  observe(continuity, 9);

  const result = observe(continuity, 1, { generation: 8 });

  assert.equal(result.status, 'new-stream');
  assert.equal(result.gap, null);
  assert.equal(continuity.pageStreams.length, 2);
});

test('unknown document identity is ignored conservatively', () => {
  const continuity = { pageStreams: [] };

  const result = observe(continuity, 1, { documentId: 'unknown' });

  assert.equal(result.status, 'ignored');
  assert.equal(result.gap, null);
  assert.equal(continuity.pageStreams.length, 0);
});

test('producer stream history remains bounded', () => {
  const continuity = { pageStreams: [] };

  let result = null;

  for (let index = 0; index < MAX_PAGE_CONTINUITY_STREAMS + 5; index += 1) {
    result = observe(continuity, 1, {
      documentId: `doc-${index}`,
      observedAt: index + 1
    });
  }

  assert.equal(continuity.pageStreams.length, MAX_PAGE_CONTINUITY_STREAMS);
  assert.ok(Array.isArray(result.evicted));
  assert.equal(result.evicted.length, 1);
  assert.equal(
    continuity.pageStreams.some(item => item.documentId === 'doc-0'),
    false
  );
  assert.equal(
    continuity.pageStreams.some(item => item.documentId === `doc-${MAX_PAGE_CONTINUITY_STREAMS + 4}`),
    true
  );
});
