import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverSessionFromIndexedDb } from '../src/indexeddb-session-recovery.js';

function reader(overrides = {}) {
  return {
    async getActiveSession() { return null; },
    async getSession() { return null; },
    async getRecordsBySession() { return []; },
    async getEntitiesBySession() { return []; },
    ...overrides
  };
}

test('recovery reports a missing active session without inventing state', async () => {
  const result = await recoverSessionFromIndexedDb({
    tabId: 7,
    persistence: reader()
  });

  assert.equal(result.status, 'missing');
  assert.equal(result.session, null);
  assert.deepEqual(result.issues, []);
});

test('recovery reports an active pointer whose header is missing', async () => {
  const result = await recoverSessionFromIndexedDb({
    tabId: 7,
    persistence: reader({
      async getActiveSession() { return { tabId: 7, sessionId: 'session-a' }; }
    })
  });

  assert.equal(result.status, 'missing-header');
  assert.equal(result.session, null);
  assert.deepEqual(result.issues, ['active-session-header-missing']);
});

test('recovery rejects a header owned by another tab', async () => {
  const result = await recoverSessionFromIndexedDb({
    tabId: 7,
    persistence: reader({
      async getActiveSession() { return { tabId: 7, sessionId: 'session-a' }; },
      async getSession() { return { tabId: 8, sessionId: 'session-a' }; }
    })
  });

  assert.equal(result.status, 'invalid-header');
  assert.equal(result.session, null);
  assert.deepEqual(result.issues, ['active-session-header-mismatch']);
});

test('recovery hydrates persisted records into the existing session shape', async () => {
  const header = {
    schemaVersion: 4,
    tabId: 7,
    sessionId: 'session-a',
    sequence: 4,
    runState: 'running'
  };

  const records = [
    {
      recordKey: 'session-a:timeline:3',
      sessionId: 'session-a',
      bucket: 'timeline',
      sequence: 3,
      value: { kind: 'third', sequence: 3 }
    },
    {
      recordKey: 'session-a:timeline:1',
      sessionId: 'session-a',
      bucket: 'timeline',
      sequence: 1,
      value: { kind: 'first', sequence: 1 }
    },
    {
      recordKey: 'session-a:network:4',
      sessionId: 'session-a',
      bucket: 'network',
      sequence: 4,
      value: { kind: 'request', sequence: 4 }
    }
  ];

  const entities = [
    {
      entityKey: 'session-a:source:src-1',
      sessionId: 'session-a',
      bucket: 'source',
      value: { id: 'src-1', text: 'const x = 1;' }
    },
    {
      entityKey: 'session-a:html:current',
      sessionId: 'session-a',
      bucket: 'html',
      value: '<main>persisted</main>'
    },
    {
      entityKey: 'session-a:runtime:current',
      sessionId: 'session-a',
      bucket: 'runtime',
      value: [{ key: 'x', value: 1 }]
    }
  ];

  const result = await recoverSessionFromIndexedDb({
    tabId: 7,
    persistence: reader({
      async getActiveSession() { return { tabId: 7, sessionId: 'session-a' }; },
      async getSession() { return header; },
      async getRecordsBySession() { return records; },
      async getEntitiesBySession() { return entities; }
    })
  });

  assert.equal(result.status, 'recovered');
  assert.equal(result.session.sessionId, 'session-a');
  assert.deepEqual(result.session.timeline.map(item => item.sequence), [1, 3]);
  assert.deepEqual(result.session.network.map(item => item.sequence), [4]);
  assert.equal(result.records.length, 3);
  assert.equal(result.entities.length, 3);
  assert.deepEqual(result.session.sources, [{ id: 'src-1', text: 'const x = 1;' }]);
  assert.equal(result.session.html, '<main>persisted</main>');
  assert.deepEqual(result.session.runtime, [{ key: 'x', value: 1 }]);
  assert.deepEqual(result.issues, []);
});

test('recovery rejects an invalid active session pointer', async () => {
  const result = await recoverSessionFromIndexedDb({
    tabId: 7,
    persistence: reader({
      async getActiveSession() { return { tabId: 8, sessionId: '' }; }
    })
  });

  assert.equal(result.status, 'invalid-pointer');
  assert.equal(result.session, null);
  assert.deepEqual(result.issues, ['invalid-active-session-pointer']);
});
