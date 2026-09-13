import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decomposeSession,
  hydrateSession
} from '../src/session-persistence-model.js';

function sampleSession() {
  return {
    schemaVersion: 4,
    tabId: 7,
    sessionId: 'session-test',
    runState: 'running',
    pageUrl: 'https://example.test/',
    html: '<html></html>',
    runtime: [{ key: 'feature', value: 'present' }],
    sources: [{ id: 'src-1', text: 'source' }],
    documents: [{ documentId: 'doc-1' }],
    timeline: [
      { eventId: 'evt-1', sequence: 1, kind: 'click' },
      { eventId: 'evt-3', sequence: 3, kind: 'marker' }
    ],
    network: [
      {
        eventId: 'evt-2',
        sequence: 2,
        kind: 'network-request',
        data: { requestId: 'request-1' }
      }
    ]
  };
}

test('decomposition removes bulk record arrays from the session header', () => {
  const session = sampleSession();
  const { header, records } = decomposeSession(session);

  assert.equal(Object.hasOwn(header, 'timeline'), false);
  assert.equal(Object.hasOwn(header, 'network'), false);
  assert.deepEqual(header.sources, session.sources);
  assert.deepEqual(header.documents, session.documents);
  assert.equal(records.length, 3);
});

test('decompose and hydrate preserve the existing session shape', () => {
  const session = sampleSession();
  const { header, records } = decomposeSession(session);

  assert.deepEqual(hydrateSession(header, records), session);
});

test('hydration restores retained record ordering', () => {
  const session = sampleSession();
  const { header, records } = decomposeSession(session);

  const reversed = [...records].reverse();
  const hydrated = hydrateSession(header, reversed);

  assert.deepEqual(hydrated.timeline, session.timeline);
  assert.deepEqual(hydrated.network, session.network);
});

test('hydration ignores records from another session', () => {
  const session = sampleSession();
  const { header, records } = decomposeSession(session);

  records.push({
    recordKey: 'foreign:timeline:99',
    sessionId: 'foreign',
    bucket: 'timeline',
    sequence: 99,
    ordinal: 99,
    value: { kind: 'foreign' }
  });

  assert.deepEqual(hydrateSession(header, records), session);
});

test('decomposition requires a persistent session identity', () => {
  assert.throws(
    () => decomposeSession({ tabId: 1 }),
    /session\.sessionId is required/
  );
});

test('record persistence rejects unstable records without sequence', () => {
  const session = sampleSession();
  session.timeline.push({ eventId: 'evt-no-sequence', kind: 'click' });

  assert.throws(
    () => decomposeSession(session),
    /timeline record requires a stable integer sequence/
  );
});
