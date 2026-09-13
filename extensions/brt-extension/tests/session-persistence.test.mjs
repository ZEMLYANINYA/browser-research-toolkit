import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSessionPersistence,
  sessionStorageKey
} from '../src/session-persistence.js';

function fakeStorage() {
  const data = new Map();
  const calls = [];

  return {
    calls,
    async get(key) {
      calls.push({ op: 'get', key });
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(values) {
      calls.push({ op: 'set', values });
      for (const [key, value] of Object.entries(values)) data.set(key, value);
    },
    async remove(key) {
      calls.push({ op: 'remove', key });
      data.delete(key);
    }
  };
}

test('session storage key preserves existing chrome.storage naming', () => {
  assert.equal(sessionStorageKey(42), 'brt_session_42');
});

test('session persistence loads missing sessions as null', async () => {
  const storage = fakeStorage();
  const persistence = createSessionPersistence(storage);

  assert.equal(await persistence.load(7), null);
  assert.deepEqual(storage.calls, [{ op: 'get', key: 'brt_session_7' }]);
});

test('session persistence round-trips the existing session snapshot', async () => {
  const storage = fakeStorage();
  const persistence = createSessionPersistence(storage);
  const session = { sessionId: 'session-test', schemaVersion: 4, sequence: 12 };

  await persistence.save(7, session);
  assert.strictEqual(await persistence.load(7), session);

  assert.equal(storage.calls[0].op, 'set');
  assert.deepEqual(storage.calls[0].values, { brt_session_7: session });
  assert.deepEqual(storage.calls[1], { op: 'get', key: 'brt_session_7' });
});

test('session persistence removes the persisted snapshot', async () => {
  const storage = fakeStorage();
  const persistence = createSessionPersistence(storage);
  const session = { sessionId: 'session-test' };

  await persistence.save(9, session);
  await persistence.remove(9);

  assert.equal(await persistence.load(9), null);
  assert.deepEqual(storage.calls[1], { op: 'remove', key: 'brt_session_9' });
});
