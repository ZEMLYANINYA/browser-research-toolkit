import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createIndexedDbPersistence } from '../src/indexeddb-persistence.js';
import { createRecordDeltaQueue } from '../src/record-delta-queue.js';
import { createPersistedRecord, hydrateSession } from '../src/session-persistence-model.js';
import { flushSessionToIndexedDb } from '../src/indexeddb-session-flush.js';
import { recoverSessionFromIndexedDb } from '../src/indexeddb-session-recovery.js';

function dbName() {
  return `brt-sw-recovery-${Date.now()}-${Math.random()}`;
}

function timelineEvent(sessionId, sequence, kind) {
  return {
    sessionId,
    sequence,
    kind,
    eventId: `evt-${sequence}`
  };
}

test('START -> events -> worker death -> recovery -> events -> STOP preserves one durable session', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName()
  });

  const tabId = 71;
  const sessionId = 'session-sw-recovery';

  // Worker incarnation A.
  const sessionA = {
    schemaVersion: 4,
    tabId,
    sessionId,
    sequence: 0,
    running: true,
    runState: 'running',
    diagnostics: [],
    timeline: [],
    network: []
  };

  const queueA = createRecordDeltaQueue();

  sessionA.timeline.push(timelineEvent(sessionId, 1, 'before-restart-a'));
  sessionA.timeline.push(timelineEvent(sessionId, 2, 'before-restart-b'));
  sessionA.sequence = 2;

  for (const value of sessionA.timeline) {
    queueA.put(createPersistedRecord(sessionId, 'timeline', value));
  }

  await flushSessionToIndexedDb({
    session: sessionA,
    deltaQueue: queueA,
    persistence,
    bootstrap: true
  });

  // Simulated MV3 service-worker death: sessionA and queueA are no longer
  // authoritative. Only IndexedDB survives into incarnation B.
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

  // Worker incarnation B.
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
  const afterRestart = timelineEvent(sessionId, 3, 'after-restart');

  sessionB.timeline.push(afterRestart);
  sessionB.sequence = 3;
  sessionB.running = false;
  sessionB.runState = 'stopped';

  queueB.put(createPersistedRecord(sessionId, 'timeline', afterRestart));

  await flushSessionToIndexedDb({
    session: sessionB,
    deltaQueue: queueB,
    persistence,
    bootstrap: false
  });

  // Persisted export shape.
  const pointer = await persistence.getActiveSession(tabId);
  assert.equal(pointer.sessionId, sessionId);

  const header = await persistence.getSession(sessionId);
  const records = await persistence.getRecordsBySession(sessionId);
  const exported = hydrateSession(header, records);

  assert.equal(exported.sessionId, sessionId);
  assert.equal(exported.running, false);
  assert.equal(exported.runState, 'stopped');
  assert.deepEqual(
    exported.timeline.map(item => item.sequence),
    [1, 2, 3]
  );
  assert.equal(
    exported.diagnostics.some(item => item.kind === 'indexeddb-session-recovered'),
    true
  );
});
