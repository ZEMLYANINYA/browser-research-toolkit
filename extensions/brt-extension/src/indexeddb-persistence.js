const DEFAULT_DB_NAME = 'brt-extension';
const DEFAULT_DB_VERSION = 1;

export const SESSION_STORE = 'sessions';
export const RECORD_STORE = 'records';
export const ENTITY_STORE = 'entities';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
  });
}

export function createIndexedDbPersistence(indexedDbFactory, options = {}) {
  if (!indexedDbFactory?.open) throw new TypeError('indexedDbFactory is required.');

  const dbName = options.dbName || DEFAULT_DB_NAME;
  const dbVersion = Number(options.dbVersion) || DEFAULT_DB_VERSION;
  let dbPromise = null;

  function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDbFactory.open(dbName, dbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          db.createObjectStore(SESSION_STORE, { keyPath: 'tabId' });
        }

        if (!db.objectStoreNames.contains(RECORD_STORE)) {
          const store = db.createObjectStore(RECORD_STORE, { keyPath: 'recordKey' });
          store.createIndex('bySession', 'sessionId', { unique: false });
          store.createIndex('bySessionBucketSequence', ['sessionId', 'bucket', 'sequence'], { unique: false });
        }

        if (!db.objectStoreNames.contains(ENTITY_STORE)) {
          const store = db.createObjectStore(ENTITY_STORE, { keyPath: 'entityKey' });
          store.createIndex('bySession', 'sessionId', { unique: false });
          store.createIndex('bySessionBucket', ['sessionId', 'bucket'], { unique: false });
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('IndexedDB open failed.'));
      };

      request.onblocked = () => {
        // Blocked is not terminal. IndexedDB may continue the same open
        // request once older connections close.
      };
    });

    return dbPromise;
  }

  async function get(storeName, key) {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    const result = await requestResult(request);
    await transactionDone(tx);
    return result ?? null;
  }

  async function getAllByIndex(storeName, indexName, query) {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).index(indexName).getAll(query);
    const result = await requestResult(request);
    await transactionDone(tx);
    return Array.isArray(result) ? result : [];
  }
  async function put(storeName, value) {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    await transactionDone(tx);
  }

  async function remove(storeName, key) {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    await transactionDone(tx);
  }

  function replaceRecordsForSession(store, sessionId, records) {
    return new Promise((resolve, reject) => {
      const request = store.index('bySession').openCursor(sessionId);

      request.onerror = () => {
        reject(request.error || new Error('IndexedDB session record replacement failed.'));
      };

      request.onsuccess = () => {
        try {
          const cursor = request.result;

          if (cursor) {
            cursor.delete();
            cursor.continue();
            return;
          }

          for (const record of records) store.put(record);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
    });
  }
  async function writeBatch({ session = null, records = [], recordDeletes = [], entities = [], replaceRecordSessionId = null } = {}) {
    const db = await openDatabase();
    const storeNames = [];

    if (session) storeNames.push(SESSION_STORE);
    if (records.length || recordDeletes.length || replaceRecordSessionId) storeNames.push(RECORD_STORE);
    if (entities.length) storeNames.push(ENTITY_STORE);

    if (!storeNames.length) return;

    const tx = db.transaction(storeNames, 'readwrite');
    const done = transactionDone(tx);

    try {
      if (session) {
        tx.objectStore(SESSION_STORE).put(session);
      }

      if (records.length || recordDeletes.length || replaceRecordSessionId) {
        const store = tx.objectStore(RECORD_STORE);

        if (replaceRecordSessionId) {
          for (const record of records) {
            if (record?.sessionId !== replaceRecordSessionId) {
              throw new TypeError('Replacement records must belong to replaceRecordSessionId.');
            }
          }

          await replaceRecordsForSession(store, replaceRecordSessionId, records);
        } else {
          for (const record of records) store.put(record);
          for (const recordKey of recordDeletes) store.delete(recordKey);
        }
      }

      if (entities.length) {
        const store = tx.objectStore(ENTITY_STORE);
        for (const entity of entities) store.put(entity);
      }
    } catch (error) {
      try {
        tx.abort();
      } catch {}

      try {
        await done;
      } catch {}

      throw error;
    }

    await done;
  }
  return Object.freeze({
    openDatabase,
    getSession(tabId) {
      return get(SESSION_STORE, tabId);
    },
    putSession(sessionHeader) {
      return put(SESSION_STORE, sessionHeader);
    },
    deleteSession(tabId) {
      return remove(SESSION_STORE, tabId);
    },
    putRecord(record) {
      return put(RECORD_STORE, record);
    },
    getRecord(recordKey) {
      return get(RECORD_STORE, recordKey);
    },
    getRecordsBySession(sessionId) {
      return getAllByIndex(RECORD_STORE, 'bySession', sessionId);
    },
    getEntitiesBySession(sessionId) {
      return getAllByIndex(ENTITY_STORE, 'bySession', sessionId);
    },
    writeBatch,
    putEntity(entity) {
      return put(ENTITY_STORE, entity);
    },
    getEntity(entityKey) {
      return get(ENTITY_STORE, entityKey);
    }
  });
}
