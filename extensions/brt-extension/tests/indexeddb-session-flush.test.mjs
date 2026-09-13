import test from 'node:test';
import assert from 'node:assert/strict';

import { createRecordDeltaQueue } from '../src/record-delta-queue.js';
import { createEntityDeltaQueue } from '../src/entity-delta-queue.js';
import { createPersistedRecord } from '../src/session-persistence-model.js';
import { createPersistedEntity } from '../src/session-entity-model.js';
import { flushSessionToIndexedDb } from '../src/indexeddb-session-flush.js';

function sessionFixture() {
  return {
    tabId: 7,
    sessionId: 'session-test',
    sequence: 2,
    running: true,
    timeline: [
      { kind: 'marker', sequence: 1 }
    ],
    network: [
      { kind: 'network-request', sequence: 2 }
    ],
    sources: [{ id: 'src-1', text: 'const answer = 42;' }],
    html: '<main>fixture</main>',
    runtime: [{ key: 'answer', value: 42 }],
    diagnostics: []
  };
}

test('incremental flush writes only drained record mutations', async () => {
  const session = sessionFixture();
  const queue = createRecordDeltaQueue();
  const entityQueue = createEntityDeltaQueue();
  const record = createPersistedRecord(session.sessionId, 'timeline', session.timeline[0]);
  const calls = [];

  queue.put(record);

  const persistence = {
    async writeBatch(batch) {
      calls.push(batch);
    }
  };

  const result = await flushSessionToIndexedDb({ session, deltaQueue: queue, entityDeltaQueue: entityQueue, persistence });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].records, [record]);
  assert.deepEqual(calls[0].recordDeletes, []);
  assert.equal(calls[0].activeSession.tabId, session.tabId);
  assert.equal(calls[0].activeSession.sessionId, session.sessionId);
  assert.equal(Number.isFinite(calls[0].activeSession.updatedAt), true);
  assert.equal('timeline' in calls[0].session, false);
  assert.equal('network' in calls[0].session, false);
  assert.equal(queue.isEmpty(), true);
  assert.deepEqual(result, { bootstrap: false, recordsWritten: 1, recordsDeleted: 0, entitiesWritten: 0, entitiesDeleted: 0 });
});

test('bootstrap flush persists all retained timeline and network records', async () => {
  const session = sessionFixture();
  const queue = createRecordDeltaQueue();
  const entityQueue = createEntityDeltaQueue();
  let written = null;

  const persistence = {
    async writeBatch(batch) {
      written = batch;
    }
  };

  const result = await flushSessionToIndexedDb({
    session,
    deltaQueue: queue,
    entityDeltaQueue: entityQueue,
    persistence,
    bootstrap: true
  });

  assert.equal(written.records.length, 2);
  assert.deepEqual(written.recordDeletes, []);
  assert.equal(written.replaceRecordSessionId, 'session-test');
  assert.deepEqual(
    written.records.map(record => record.recordKey),
    ['session-test:timeline:1', 'session-test:network:2']
  );
  assert.equal(result.recordsWritten, 2);
  assert.equal(written.entities.length, 3);
  assert.deepEqual(written.entities.map(entity => entity.bucket).sort(), ['html', 'runtime', 'source']);
  assert.equal(written.replaceEntitySessionId, 'session-test');
  assert.equal('sources' in written.session, false);
  assert.equal('html' in written.session, false);
  assert.equal('runtime' in written.session, false);
  assert.equal(result.entitiesWritten, 3);
  assert.equal(result.entitiesDeleted, 0);
  assert.equal(result.bootstrap, true);
});

test('record tombstones are forwarded in the same durable batch', async () => {
  const session = sessionFixture();
  const queue = createRecordDeltaQueue();
  const entityQueue = createEntityDeltaQueue();
  const key = 'session-test:timeline:9';
  let written = null;

  queue.remove(key);

  const persistence = {
    async writeBatch(batch) {
      written = batch;
    }
  };

  await flushSessionToIndexedDb({ session, deltaQueue: queue, entityDeltaQueue: entityQueue, persistence });

  assert.deepEqual(written.records, []);
  assert.deepEqual(written.recordDeletes, [key]);
  assert.equal(queue.isEmpty(), true);
});

test('mutations arriving during a successful write remain queued', async () => {
  const session = sessionFixture();
  const queue = createRecordDeltaQueue();
  const entityQueue = createEntityDeltaQueue();
  const first = createPersistedRecord(session.sessionId, 'timeline', { kind: 'first', sequence: 1 });
  const second = createPersistedRecord(session.sessionId, 'timeline', { kind: 'second', sequence: 3 });

  let releaseWrite;
  const pendingWrite = new Promise(resolve => { releaseWrite = resolve; });

  const persistence = {
    async writeBatch() {
      await pendingWrite;
    }
  };

  queue.put(first);
  const flushing = flushSessionToIndexedDb({ session, deltaQueue: queue, entityDeltaQueue: entityQueue, persistence });

  queue.put(second);
  releaseWrite();
  await flushing;

  assert.deepEqual(queue.snapshot(), { puts: [second], deletes: [] });
});

test('failed write requeues old batch while newer mutation wins', async () => {
  const session = sessionFixture();
  const queue = createRecordDeltaQueue();
  const entityQueue = createEntityDeltaQueue();
  const key = 'session-test:timeline:1';
  const oldRecord = createPersistedRecord(session.sessionId, 'timeline', { kind: 'old', sequence: 1 });

  let rejectWrite;
  const pendingWrite = new Promise((resolve, reject) => { rejectWrite = reject; });

  const persistence = {
    async writeBatch() {
      await pendingWrite;
    }
  };

  queue.put(oldRecord);
  const flushing = flushSessionToIndexedDb({ session, deltaQueue: queue, entityDeltaQueue: entityQueue, persistence });

  queue.remove(key);
  rejectWrite(new Error('disk unavailable'));

  await assert.rejects(flushing, /disk unavailable/);
  assert.deepEqual(queue.snapshot(), { puts: [], deletes: [key] });
});

test('invalid collaborators fail before draining queued mutations', async () => {
  const session = sessionFixture();
  const queue = createRecordDeltaQueue();
  const entityQueue = createEntityDeltaQueue();
  const record = createPersistedRecord(session.sessionId, 'timeline', session.timeline[0]);

  queue.put(record);

  await assert.rejects(
    flushSessionToIndexedDb({ session, deltaQueue: queue, entityDeltaQueue: entityQueue, persistence: {} }),
    /persistence\.writeBatch is required/
  );

  assert.deepEqual(queue.snapshot(), { puts: [record], deletes: [] });
});

test('incremental entity mutations are forwarded without rewriting retained entities', async () => {
  const session = sessionFixture();
  const queue = createRecordDeltaQueue();
  const entityQueue = createEntityDeltaQueue();
  const entity = createPersistedEntity(session.sessionId, 'source', { id: 'src-new', text: 'new source' });
  let written = null;

  entityQueue.put(entity);

  await flushSessionToIndexedDb({
    session,
    deltaQueue: queue,
    entityDeltaQueue: entityQueue,
    persistence: {
      async writeBatch(batch) { written = batch; }
    }
  });

  assert.deepEqual(written.entities, [entity]);
  assert.deepEqual(written.entityDeletes, []);
  assert.equal(written.replaceEntitySessionId, null);
  assert.equal(entityQueue.isEmpty(), true);
});

test('entity tombstones are forwarded in the same durable batch', async () => {
  const session = sessionFixture();
  const queue = createRecordDeltaQueue();
  const entityQueue = createEntityDeltaQueue();
  const entityKey = 'session-test:source:evicted';
  let written = null;

  entityQueue.remove(entityKey);

  await flushSessionToIndexedDb({
    session,
    deltaQueue: queue,
    entityDeltaQueue: entityQueue,
    persistence: {
      async writeBatch(batch) { written = batch; }
    }
  });

  assert.deepEqual(written.entities, []);
  assert.deepEqual(written.entityDeletes, [entityKey]);
  assert.equal(entityQueue.isEmpty(), true);
});

test('failed write requeues both record and entity batches with newer mutations winning', async () => {
  const session = sessionFixture();
  const queue = createRecordDeltaQueue();
  const entityQueue = createEntityDeltaQueue();
  const recordKey = 'session-test:timeline:1';
  const entityKey = 'session-test:source:src-old';
  const oldRecord = createPersistedRecord(session.sessionId, 'timeline', { kind: 'old', sequence: 1 });
  const oldEntity = createPersistedEntity(session.sessionId, 'source', { id: 'src-old', text: 'old' });

  let rejectWrite;
  const pendingWrite = new Promise((resolve, reject) => { rejectWrite = reject; });

  queue.put(oldRecord);
  entityQueue.put(oldEntity);

  const flushing = flushSessionToIndexedDb({
    session,
    deltaQueue: queue,
    entityDeltaQueue: entityQueue,
    persistence: {
      async writeBatch() { await pendingWrite; }
    }
  });

  queue.remove(recordKey);
  entityQueue.remove(entityKey);
  rejectWrite(new Error('disk unavailable'));

  await assert.rejects(flushing, /disk unavailable/);
  assert.deepEqual(queue.snapshot(), { puts: [], deletes: [recordKey] });
  assert.deepEqual(entityQueue.snapshot(), { puts: [], deletes: [entityKey] });
});
