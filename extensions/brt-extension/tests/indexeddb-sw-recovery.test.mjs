import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createIndexedDbPersistence } from '../src/indexeddb-persistence.js';
import { createRecordDeltaQueue } from '../src/record-delta-queue.js';
import { createEntityDeltaQueue } from '../src/entity-delta-queue.js';
import { createPersistedRecord } from '../src/session-persistence-model.js';
import { createPersistedEntity } from '../src/session-entity-model.js';
import { flushSessionToIndexedDb } from '../src/indexeddb-session-flush.js';
import { recoverSessionFromIndexedDb } from '../src/indexeddb-session-recovery.js';
import { observePageProducerSequence } from '../src/capture-continuity.js';

function dbName() {
  return `brt-sw-recovery-${Date.now()}-${Math.random()}`;
}

function pageTimelineEvent(sessionId, sequence, producerSequence, kind) {
  return {
    sessionId,
    sequence,
    producerSequence,
    kind,
    eventId: `evt-producer-${producerSequence}`,
    generation: 1,
    runId: 'run-sw-recovery',
    documentId: 'doc-main',
    frameId: 0,
    provenance: {
      collector: 'main-world-page-agent',
      transport: 'window.postMessage→isolated-content-script',
      integrity: 'page-observable'
    }
  };
}

function observeProducer(session, producerSequence) {
  const result = observePageProducerSequence({
    continuity: session.continuity,
    generation: session.generation,
    runId: session.runId,
    documentId: 'doc-main',
    frameId: 0,
    producerSequence,
    observedAt: producerSequence * 100
  });

  session.continuity = result.state;
  return result;
}

test('START -> events -> worker death -> recovery -> producer gap -> STOP -> EXPORT preserves diagnostics', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName()
  });

  const tabId = 71;
  const sessionId = 'session-sw-recovery';

  // START: worker incarnation A owns the live in-memory session.
  const sessionA = {
    schemaVersion: 4,
    tabId,
    sessionId,
    runId: 'run-sw-recovery',
    generation: 1,
    sequence: 0,
    continuity: { pageStreams: [] },
    running: true,
    runState: 'running',
    diagnostics: [],
    timeline: [],
    network: [],
    sources: [{ id: 'src-before-restart', text: 'const before = true;' }],
    html: '<main>before restart</main>',
    runtime: [{ key: 'phase', value: 'before-restart' }]
  };

  const queueA = createRecordDeltaQueue();
  const entityQueueA = createEntityDeltaQueue();

  // Producer events 1 and 2 are observed and durably persisted.
  for (const producerSequence of [1, 2]) {
    const continuity = observeProducer(sessionA, producerSequence);
    assert.equal(continuity.gap, null);

    const event = pageTimelineEvent(
      sessionId,
      ++sessionA.sequence,
      producerSequence,
      `before-restart-${producerSequence}`
    );

    sessionA.timeline.push(event);
    queueA.put(createPersistedRecord(sessionId, 'timeline', event));
  }

  await flushSessionToIndexedDb({
    session: sessionA,
    deltaQueue: queueA,
    entityDeltaQueue: entityQueueA,
    persistence,
    bootstrap: true
  });

  assert.equal(sessionA.continuity.pageStreams.length, 1);
  assert.equal(sessionA.continuity.pageStreams[0].lastProducerSequence, 2);

  // Simulated MV3 service-worker lifecycle break. Producer sequence 3 is
  // not accepted by background across the interruption, while the page-side
  // producer continues running. Only the previously durable IndexedDB cursor
  // survives into worker incarnation B.

  const recovery = await recoverSessionFromIndexedDb({
    tabId,
    persistence
  });

  assert.equal(recovery.status, 'recovered');
  assert.equal(recovery.session.sessionId, sessionId);
  assert.deepEqual(
    recovery.session.timeline.map(item => item.sequence),
    [1, 2]
  );
  assert.deepEqual(
    recovery.session.timeline.map(item => item.producerSequence),
    [1, 2]
  );
  assert.equal(
    recovery.session.continuity.pageStreams[0].lastProducerSequence,
    2
  );
  assert.deepEqual(recovery.session.sources, sessionA.sources);
  assert.equal(recovery.session.html, '<main>before restart</main>');
  assert.deepEqual(
    recovery.session.runtime,
    [{ key: 'phase', value: 'before-restart' }]
  );
  assert.equal(recovery.entities.length, 3);

  // Worker incarnation B recovers the durable producer cursor.
  const sessionB = recovery.session;
  sessionB.diagnostics = Array.isArray(sessionB.diagnostics)
    ? sessionB.diagnostics
    : [];

  sessionB.diagnostics.push({
    kind: 'indexeddb-session-recovered',
    sessionId,
    sequenceAtRecovery: sessionB.sequence
  });

  const queueB = createRecordDeltaQueue();
  const entityQueueB = createEntityDeltaQueue();

  // Producer sequence 4 is the first event received after recovery.
  // The persisted cursor is still 2, therefore producer sequence 3 is
  // observably missing even though canonical session ordering remains
  // consecutive.
  const continuityAfterRestart = observeProducer(sessionB, 4);

  assert.equal(continuityAfterRestart.status, 'gap');
  assert.deepEqual(continuityAfterRestart.gap, {
    expectedProducerSequence: 3,
    receivedProducerSequence: 4,
    missingCount: 1,
    generation: 1,
    runId: 'run-sw-recovery',
    documentId: 'doc-main',
    frameId: 0,
    provenance: 'page-observable'
  });

  sessionB.diagnostics.push({
    kind: 'page-producer-sequence-gap',
    ...continuityAfterRestart.gap
  });

  const afterRestart = pageTimelineEvent(
    sessionId,
    ++sessionB.sequence,
    4,
    'after-restart'
  );

  sessionB.timeline.push(afterRestart);
  sessionB.running = false;
  sessionB.runState = 'stopped';
  sessionB.html = '<main>after restart</main>';

  queueB.put(createPersistedRecord(sessionId, 'timeline', afterRestart));
  entityQueueB.put(createPersistedEntity(sessionId, 'html', sessionB.html));

  // STOP persists the recovered session, recovery marker, gap diagnostic,
  // continuity cursor, and post-restart evidence in one durable state.
  await flushSessionToIndexedDb({
    session: sessionB,
    deltaQueue: queueB,
    entityDeltaQueue: entityQueueB,
    persistence,
    bootstrap: false
  });

  // EXPORT reads the durable IndexedDB representation rather than the
  // in-memory session object.
  const exportedRecovery = await recoverSessionFromIndexedDb({
    tabId,
    persistence
  });

  assert.equal(exportedRecovery.status, 'recovered');
  const exported = exportedRecovery.session;

  assert.equal(exported.sessionId, sessionId);
  assert.equal(exported.running, false);
  assert.equal(exported.runState, 'stopped');

  assert.deepEqual(
    exported.timeline.map(item => item.sequence),
    [1, 2, 3]
  );

  assert.deepEqual(
    exported.timeline.map(item => item.producerSequence),
    [1, 2, 4]
  );

  assert.equal(
    exported.continuity.pageStreams[0].lastProducerSequence,
    4
  );

  assert.deepEqual(exported.sources, sessionA.sources);
  assert.equal(exported.html, '<main>after restart</main>');
  assert.deepEqual(
    exported.runtime,
    [{ key: 'phase', value: 'before-restart' }]
  );

  assert.equal(
    exported.diagnostics.some(item =>
      item.kind === 'indexeddb-session-recovered'
    ),
    true
  );

  const gapDiagnostic = exported.diagnostics.find(item =>
    item.kind === 'page-producer-sequence-gap'
  );

  assert.ok(gapDiagnostic);
  assert.equal(gapDiagnostic.expectedProducerSequence, 3);
  assert.equal(gapDiagnostic.receivedProducerSequence, 4);
  assert.equal(gapDiagnostic.missingCount, 1);
  assert.equal(gapDiagnostic.provenance, 'page-observable');
});
