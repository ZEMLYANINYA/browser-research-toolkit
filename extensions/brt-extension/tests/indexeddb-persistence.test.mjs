import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';

import {
  createIndexedDbPersistence,
  SESSION_STORE,
  ACTIVE_SESSION_STORE,
  RECORD_STORE,
  ENTITY_STORE
} from '../src/indexeddb-persistence.js';

function dbName(label) {
  return `brt-test-${label}-${Date.now()}-${Math.random()}`;
}

test('opens v2 database with session-keyed stores', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('schema')
  });

  const db = await persistence.openDatabase();

  assert.equal(db.version, 2);
  assert.equal(db.objectStoreNames.contains(SESSION_STORE), true);
  assert.equal(db.objectStoreNames.contains(ACTIVE_SESSION_STORE), true);
  assert.equal(db.objectStoreNames.contains(RECORD_STORE), true);
  assert.equal(db.objectStoreNames.contains(ENTITY_STORE), true);

  const tx = db.transaction(SESSION_STORE, 'readonly');
  const store = tx.objectStore(SESSION_STORE);
  assert.equal(store.keyPath, 'sessionId');
  assert.equal(store.indexNames.contains('byTab'), true);
});

test('session header round-trips by sessionId', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('session')
  });

  const session = { tabId: 7, sessionId: 'session-test', runState: 'running' };

  await persistence.putSession(session);
  assert.deepEqual(await persistence.getSession('session-test'), session);

  await persistence.deleteSession('session-test');
  assert.equal(await persistence.getSession('session-test'), null);
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

  assert.equal((await persistence.getSession('batch-session')).sessionId, 'batch-session');
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

  assert.equal(await persistence.getSession('rollback-session'), null);
  assert.equal(
    await persistence.getRecord('rollback-session:timeline:1'),
    null
  );
});

test('writeBatch deletes persisted records by recordKey', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('record-delete')
  });

  const record = {
    recordKey: 'delete-session:timeline:1',
    sessionId: 'delete-session',
    bucket: 'timeline',
    sequence: 1,
    value: { kind: 'click' }
  };

  await persistence.putRecord(record);
  assert.deepEqual(await persistence.getRecord(record.recordKey), record);

  await persistence.writeBatch({
    recordDeletes: [record.recordKey]
  });

  assert.equal(await persistence.getRecord(record.recordKey), null);
});

test('writeBatch commits record puts deletes and session header together', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('mixed-record-batch')
  });

  await persistence.putRecord({
    recordKey: 'mixed-session:timeline:1',
    sessionId: 'mixed-session',
    bucket: 'timeline',
    sequence: 1,
    value: { kind: 'old' }
  });

  await persistence.writeBatch({
    session: {
      tabId: 31,
      sessionId: 'mixed-session',
      runState: 'running'
    },
    records: [
      {
        recordKey: 'mixed-session:timeline:2',
        sessionId: 'mixed-session',
        bucket: 'timeline',
        sequence: 2,
        value: { kind: 'new' }
      }
    ],
    recordDeletes: ['mixed-session:timeline:1']
  });

  assert.equal(await persistence.getRecord('mixed-session:timeline:1'), null);
  assert.equal((await persistence.getRecord('mixed-session:timeline:2')).sequence, 2);
  assert.equal((await persistence.getSession('mixed-session')).sessionId, 'mixed-session');
});

test('writeBatch replacement removes stale records from the same session', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('replace-session-records')
  });

  await persistence.putRecord({
    recordKey: 'replace-session:timeline:1',
    sessionId: 'replace-session',
    bucket: 'timeline',
    sequence: 1,
    value: { kind: 'keep-current' }
  });

  await persistence.putRecord({
    recordKey: 'replace-session:timeline:2',
    sessionId: 'replace-session',
    bucket: 'timeline',
    sequence: 2,
    value: { kind: 'stale-ghost' }
  });

  await persistence.writeBatch({
    session: {
      tabId: 41,
      sessionId: 'replace-session',
      runState: 'running'
    },
    records: [
      {
        recordKey: 'replace-session:timeline:1',
        sessionId: 'replace-session',
        bucket: 'timeline',
        sequence: 1,
        value: { kind: 'keep-current' }
      }
    ],
    replaceRecordSessionId: 'replace-session'
  });

  const records = await persistence.getRecordsBySession('replace-session');

  assert.deepEqual(
    records.map(record => record.recordKey),
    ['replace-session:timeline:1']
  );
  assert.equal(await persistence.getRecord('replace-session:timeline:2'), null);
  assert.equal((await persistence.getSession('replace-session')).sessionId, 'replace-session');
});

test('writeBatch replacement leaves records from other sessions untouched', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('replace-session-isolation')
  });

  const foreign = {
    recordKey: 'foreign-session:network:7',
    sessionId: 'foreign-session',
    bucket: 'network',
    sequence: 7,
    value: { kind: 'foreign-record' }
  };

  await persistence.putRecord({
    recordKey: 'target-session:timeline:1',
    sessionId: 'target-session',
    bucket: 'timeline',
    sequence: 1,
    value: { kind: 'stale-target' }
  });

  await persistence.putRecord(foreign);

  await persistence.writeBatch({
    records: [
      {
        recordKey: 'target-session:timeline:2',
        sessionId: 'target-session',
        bucket: 'timeline',
        sequence: 2,
        value: { kind: 'current-target' }
      }
    ],
    replaceRecordSessionId: 'target-session'
  });

  assert.equal(await persistence.getRecord('target-session:timeline:1'), null);
  assert.equal((await persistence.getRecord('target-session:timeline:2')).sequence, 2);
  assert.deepEqual(await persistence.getRecord(foreign.recordKey), foreign);
});

test('writeBatch rejects foreign records during session replacement', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('replace-session-foreign-record')
  });

  await persistence.putRecord({
    recordKey: 'target-session:timeline:1',
    sessionId: 'target-session',
    bucket: 'timeline',
    sequence: 1,
    value: { kind: 'existing' }
  });

  await assert.rejects(
    persistence.writeBatch({
      records: [
        {
          recordKey: 'foreign-session:timeline:2',
          sessionId: 'foreign-session',
          bucket: 'timeline',
          sequence: 2,
          value: { kind: 'foreign' }
        }
      ],
      replaceRecordSessionId: 'target-session'
    }),
    /Replacement records must belong/
  );

  assert.equal((await persistence.getRecord('target-session:timeline:1')).sequence, 1);
  assert.equal(await persistence.getRecord('foreign-session:timeline:2'), null);
});

test('active session pointer round-trips by tabId', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('active-session')
  });

  const pointer = {
    tabId: 7,
    sessionId: 'session-test',
    updatedAt: 123
  };

  await persistence.putActiveSession(pointer);
  assert.deepEqual(await persistence.getActiveSession(7), pointer);

  await persistence.deleteActiveSession(7);
  assert.equal(await persistence.getActiveSession(7), null);
});

test('v1 to v2 migration replaces legacy session headers and preserves evidence', async () => {
  const name = dbName('v1-to-v2-migration');

  const openV1 = indexedDB.open(name, 1);

  openV1.onupgradeneeded = () => {
    const db = openV1.result;

    db.createObjectStore(SESSION_STORE, { keyPath: 'tabId' });

    const records = db.createObjectStore(RECORD_STORE, { keyPath: 'recordKey' });
    records.createIndex('bySession', 'sessionId', { unique: false });
    records.createIndex('bySessionBucketSequence', ['sessionId', 'bucket', 'sequence'], { unique: false });

    const entities = db.createObjectStore(ENTITY_STORE, { keyPath: 'entityKey' });
    entities.createIndex('bySession', 'sessionId', { unique: false });
    entities.createIndex('bySessionBucket', ['sessionId', 'bucket'], { unique: false });
  };

  const legacyDb = await new Promise((resolve, reject) => {
    openV1.onsuccess = () => resolve(openV1.result);
    openV1.onerror = () => reject(openV1.error);
  });

  await new Promise((resolve, reject) => {
    const tx = legacyDb.transaction(
      [SESSION_STORE, RECORD_STORE, ENTITY_STORE],
      'readwrite'
    );

    tx.objectStore(SESSION_STORE).put({
      tabId: 17,
      sessionId: 'legacy-session',
      runState: 'running'
    });

    tx.objectStore(RECORD_STORE).put({
      recordKey: 'legacy-session:timeline:4',
      sessionId: 'legacy-session',
      bucket: 'timeline',
      sequence: 4,
      value: { kind: 'legacy-record' }
    });

    tx.objectStore(ENTITY_STORE).put({
      entityKey: 'legacy-session:sources:source-1',
      sessionId: 'legacy-session',
      bucket: 'sources',
      value: { id: 'source-1' }
    });

    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Legacy fixture transaction aborted.'));
    tx.onerror = () => reject(tx.error || new Error('Legacy fixture transaction failed.'));
  });

  legacyDb.close();

  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: name
  });

  const migratedDb = await persistence.openDatabase();

  assert.equal(migratedDb.version, 2);
  assert.equal(migratedDb.objectStoreNames.contains(ACTIVE_SESSION_STORE), true);

  const schemaTx = migratedDb.transaction(SESSION_STORE, 'readonly');
  const sessionStore = schemaTx.objectStore(SESSION_STORE);

  assert.equal(sessionStore.keyPath, 'sessionId');
  assert.equal(sessionStore.indexNames.contains('byTab'), true);

  assert.equal(await persistence.getSession('legacy-session'), null);
  assert.equal(await persistence.getActiveSession(17), null);

  const records = await persistence.getRecordsBySession('legacy-session');
  const entities = await persistence.getEntitiesBySession('legacy-session');

  assert.equal(records.length, 1);
  assert.equal(records[0].recordKey, 'legacy-session:timeline:4');
  assert.equal(records[0].value.kind, 'legacy-record');

  assert.equal(entities.length, 1);
  assert.equal(entities[0].entityKey, 'legacy-session:sources:source-1');
});

test('writeBatch commits session header and active pointer atomically', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('atomic-active-session')
  });

  const session = {
    tabId: 51,
    sessionId: 'atomic-session',
    runState: 'running'
  };

  const activeSession = {
    tabId: 51,
    sessionId: 'atomic-session',
    updatedAt: 123
  };

  await persistence.writeBatch({ session, activeSession });

  assert.deepEqual(await persistence.getSession('atomic-session'), session);
  assert.deepEqual(await persistence.getActiveSession(51), activeSession);
});

test('writeBatch rolls back session header and active pointer when a later write fails', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('atomic-active-session-rollback')
  });

  await assert.rejects(
    persistence.writeBatch({
      session: {
        tabId: 52,
        sessionId: 'rollback-active-session',
        runState: 'running'
      },
      activeSession: {
        tabId: 52,
        sessionId: 'rollback-active-session',
        updatedAt: 456
      },
      entities: [
        {
          sessionId: 'rollback-active-session',
          bucket: 'sources',
          value: { id: 'missing-entity-key' }
        }
      ]
    })
  );

  assert.equal(await persistence.getSession('rollback-active-session'), null);
  assert.equal(await persistence.getActiveSession(52), null);
});

test('writeBatch rejects an active pointer that does not reference the session header', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('active-session-mismatch')
  });

  await assert.rejects(
    persistence.writeBatch({
      session: {
        tabId: 53,
        sessionId: 'session-a',
        runState: 'running'
      },
      activeSession: {
        tabId: 53,
        sessionId: 'session-b',
        updatedAt: 789
      }
    }),
    /activeSession must reference the persisted session/
  );

  assert.equal(await persistence.getSession('session-a'), null);
  assert.equal(await persistence.getActiveSession(53), null);
});

test('deleteSessionData removes the target session and its evidence', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('delete-session-data')
  });

  await persistence.writeBatch({
    session: { tabId: 61, sessionId: 'delete-me', runState: 'stopped' },
    activeSession: { tabId: 61, sessionId: 'delete-me', updatedAt: 1 },
    records: [
      {
        recordKey: 'delete-me:timeline:1',
        sessionId: 'delete-me',
        bucket: 'timeline',
        sequence: 1,
        value: { kind: 'marker' }
      }
    ],
    entities: [
      {
        entityKey: 'delete-me:sources:1',
        sessionId: 'delete-me',
        bucket: 'sources',
        value: { id: 'source-1' }
      }
    ]
  });

  await persistence.deleteSessionData({ tabId: 61, sessionId: 'delete-me' });

  assert.equal(await persistence.getSession('delete-me'), null);
  assert.equal(await persistence.getActiveSession(61), null);
  assert.deepEqual(await persistence.getRecordsBySession('delete-me'), []);
  assert.deepEqual(await persistence.getEntitiesBySession('delete-me'), []);
});

test('deleteSessionData leaves other sessions untouched', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('delete-session-isolation')
  });

  await persistence.writeBatch({
    session: { tabId: 62, sessionId: 'target-session', runState: 'stopped' },
    activeSession: { tabId: 62, sessionId: 'target-session', updatedAt: 1 },
    records: [
      { recordKey: 'target-session:timeline:1', sessionId: 'target-session', bucket: 'timeline', sequence: 1, value: {} },
      { recordKey: 'foreign-session:timeline:1', sessionId: 'foreign-session', bucket: 'timeline', sequence: 1, value: {} }
    ],
    entities: [
      { entityKey: 'target-session:sources:1', sessionId: 'target-session', bucket: 'sources', value: {} },
      { entityKey: 'foreign-session:sources:1', sessionId: 'foreign-session', bucket: 'sources', value: {} }
    ]
  });

  await persistence.putSession({ tabId: 99, sessionId: 'foreign-session', runState: 'stopped' });

  await persistence.deleteSessionData({ tabId: 62, sessionId: 'target-session' });

  assert.equal(await persistence.getSession('target-session'), null);
  assert.equal((await persistence.getSession('foreign-session')).sessionId, 'foreign-session');
  assert.equal((await persistence.getRecordsBySession('foreign-session')).length, 1);
  assert.equal((await persistence.getEntitiesBySession('foreign-session')).length, 1);
});

test('deleteSessionData preserves a newer active pointer for the same tab', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('delete-stale-pointer-guard')
  });

  await persistence.putSession({ tabId: 63, sessionId: 'old-session', runState: 'stopped' });
  await persistence.putSession({ tabId: 63, sessionId: 'new-session', runState: 'running' });
  await persistence.putActiveSession({ tabId: 63, sessionId: 'new-session', updatedAt: 2 });

  await persistence.deleteSessionData({ tabId: 63, sessionId: 'old-session' });

  assert.equal(await persistence.getSession('old-session'), null);
  assert.equal((await persistence.getSession('new-session')).sessionId, 'new-session');
  assert.equal((await persistence.getActiveSession(63)).sessionId, 'new-session');
});

test('writeBatch deletes entities by entityKey', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('entity-delete')
  });

  const entity = {
    entityKey: 'entity-session:source:src-1',
    sessionId: 'entity-session',
    bucket: 'source',
    value: { id: 'src-1', text: 'example' }
  };

  await persistence.putEntity(entity);
  assert.deepEqual(await persistence.getEntity(entity.entityKey), entity);

  await persistence.writeBatch({
    entityDeletes: [entity.entityKey]
  });

  assert.equal(await persistence.getEntity(entity.entityKey), null);
});

test('writeBatch applies entity puts and deletes in one transaction', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('entity-mixed-batch')
  });

  const oldEntity = {
    entityKey: 'entity-session:source:old',
    sessionId: 'entity-session',
    bucket: 'source',
    value: { id: 'old' }
  };

  const newEntity = {
    entityKey: 'entity-session:source:new',
    sessionId: 'entity-session',
    bucket: 'source',
    value: { id: 'new' }
  };

  await persistence.putEntity(oldEntity);

  await persistence.writeBatch({
    entities: [newEntity],
    entityDeletes: [oldEntity.entityKey]
  });

  assert.equal(await persistence.getEntity(oldEntity.entityKey), null);
  assert.deepEqual(await persistence.getEntity(newEntity.entityKey), newEntity);
});

test('writeBatch replacement removes stale entities from the same session', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('replace-session-entities')
  });

  await persistence.putEntity({
    entityKey: 'target-session:source:stale',
    sessionId: 'target-session',
    bucket: 'source',
    value: { id: 'stale' }
  });

  const retained = {
    entityKey: 'target-session:source:retained',
    sessionId: 'target-session',
    bucket: 'source',
    value: { id: 'retained' }
  };

  await persistence.writeBatch({
    entities: [retained],
    replaceEntitySessionId: 'target-session'
  });

  const entities = await persistence.getEntitiesBySession('target-session');
  assert.deepEqual(entities.map(item => item.entityKey), [retained.entityKey]);
});

test('writeBatch entity replacement leaves foreign sessions untouched', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('replace-session-entity-isolation')
  });

  const foreign = {
    entityKey: 'foreign-session:source:foreign',
    sessionId: 'foreign-session',
    bucket: 'source',
    value: { id: 'foreign' }
  };

  await persistence.putEntity(foreign);

  await persistence.writeBatch({
    entities: [],
    replaceEntitySessionId: 'target-session'
  });

  assert.deepEqual(await persistence.getEntity(foreign.entityKey), foreign);
});

test('writeBatch rejects foreign entities during session replacement', async () => {
  const persistence = createIndexedDbPersistence(indexedDB, {
    dbName: dbName('replace-session-foreign-entity')
  });

  await assert.rejects(
    persistence.writeBatch({
      entities: [{
        entityKey: 'foreign-session:source:foreign',
        sessionId: 'foreign-session',
        bucket: 'source',
        value: { id: 'foreign' }
      }],
      replaceEntitySessionId: 'target-session'
    }),
    /Replacement entities must belong to replaceEntitySessionId/
  );
});
