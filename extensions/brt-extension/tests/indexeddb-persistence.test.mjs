import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';

import {
  createIndexedDbPersistence,
  SESSION_STORE,
  RECORD_STORE,
  ENTITY_STORE
} from '../src/indexeddb-persistence.js';

function dbName(label) {
  return `brt-test-${label}-${Date.now()}-${Math.random()}`;
}

test('opens v1 database with expected stores', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('schema')
  });

  const db = await persistence.openDatabase();

  assert.equal(db.version, 1);
  assert.equal(db.objectStoreNames.contains(SESSION_STORE), true);
  assert.equal(db.objectStoreNames.contains(RECORD_STORE), true);
  assert.equal(db.objectStoreNames.contains(ENTITY_STORE), true);
});

test('session header round-trips by tabId', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('session')
  });

  const session = { tabId: 7, sessionId: 'session-test', runState: 'running' };

  await persistence.putSession(session);
  assert.deepEqual(await persistence.getSession(7), session);

  await persistence.deleteSession(7);
  assert.equal(await persistence.getSession(7), null);
});

test('append-style record round-trips by recordKey', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('record')
  });

  const record = {
    recordKey: 'session-test:timeline:12',
    sessionId: 'session-test',
    bucket: 'timeline',
    sequence: 12,
    value: { kind: 'click' }
  };

  await persistence.putRecord(record);
  assert.deepEqual(await persistence.getRecord(record.recordKey), record);
});

test('mutable entity supports upsert semantics', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('entity')
  });

  const key = 'session-test:source:src-1';

  await persistence.putEntity({
    entityKey: key,
    sessionId: 'session-test',
    bucket: 'sources',
    value: { count: 1 }
  });

  await persistence.putEntity({
    entityKey: key,
    sessionId: 'session-test',
    bucket: 'sources',
    value: { count: 2 }
  });

  assert.deepEqual(await persistence.getEntity(key), {
    entityKey: key,
    sessionId: 'session-test',
    bucket: 'sources',
    value: { count: 2 }
  });
});

test('versionchange closes the cached connection and allows upgrade', async () => {
  const name = dbName('versionchange');
  const persistenceV1 = createIndexedDbPersistence(indexedDB, {
    dbName: name,
    dbVersion: 1
  });

  await persistenceV1.openDatabase();

  const upgrade = indexedDB.open(name, 2);
  const upgraded = await new Promise((resolve, reject) => {
    upgrade.onupgradeneeded = () => {};
    upgrade.onsuccess = () => resolve(upgrade.result);
    upgrade.onerror = () => reject(upgrade.error);
  });

  assert.equal(upgraded.version, 2);
  upgraded.close();

  const persistenceV2 = createIndexedDbPersistence(indexedDB, {
    dbName: name,
    dbVersion: 2
  });

  const reopened = await persistenceV2.openDatabase();
  assert.equal(reopened.version, 2);
  reopened.close();
});

test('records and entities can be queried by session', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('query')
  });

  await persistence.putRecord({
    recordKey: 's1:timeline:1',
    sessionId: 's1',
    bucket: 'timeline',
    sequence: 1,
    value: { kind: 'click' }
  });

  await persistence.putRecord({
    recordKey: 's2:timeline:1',
    sessionId: 's2',
    bucket: 'timeline',
    sequence: 1,
    value: { kind: 'submit' }
  });

  await persistence.putEntity({
    entityKey: 's1:source:1',
    sessionId: 's1',
    bucket: 'sources',
    value: { id: 'source-1' }
  });

  const records = await persistence.getRecordsBySession('s1');
  const entities = await persistence.getEntitiesBySession('s1');

  assert.equal(records.length, 1);
  assert.equal(records[0].sessionId, 's1');
  assert.equal(entities.length, 1);
  assert.equal(entities[0].sessionId, 's1');
});

test('writeBatch persists session records and entities atomically', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('batch')
  });

  await persistence.writeBatch({
    session: { tabId: 11, sessionId: 'batch-session', runState: 'running' },
    records: [
      {
        recordKey: 'batch-session:timeline:1',
        sessionId: 'batch-session',
        bucket: 'timeline',
        sequence: 1,
        value: { kind: 'click' }
      },
      {
        recordKey: 'batch-session:network:2',
        sessionId: 'batch-session',
        bucket: 'network',
        sequence: 2,
        value: { kind: 'network-request' }
      }
    ],
    entities: [
      {
        entityKey: 'batch-session:source:src-1',
        sessionId: 'batch-session',
        bucket: 'sources',
        value: { id: 'src-1' }
      }
    ]
  });

  assert.equal((await persistence.getSession(11)).sessionId, 'batch-session');
  assert.equal((await persistence.getRecordsBySession('batch-session')).length, 2);
  assert.equal((await persistence.getEntitiesBySession('batch-session')).length, 1);
});

test('writeBatch rolls back earlier writes when a later write fails', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('batch-rollback')
  });

  await assert.rejects(
    persistence.writeBatch({
      session: {
        tabId: 21,
        sessionId: 'rollback-session',
        runState: 'running'
      },
      records: [
        {
          recordKey: 'rollback-session:timeline:1',
          sessionId: 'rollback-session',
          bucket: 'timeline',
          sequence: 1,
          value: { kind: 'click' }
        }
      ],
      entities: [
        {
          sessionId: 'rollback-session',
          bucket: 'sources',
          value: { id: 'missing-entity-key' }
        }
      ]
    })
  );

  assert.equal(await persistence.getSession(21), null);
  assert.equal(
    await persistence.getRecord('rollback-session:timeline:1'),
    null
  );
});
