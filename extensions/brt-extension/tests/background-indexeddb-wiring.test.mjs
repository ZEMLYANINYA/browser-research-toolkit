import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const background = fs.readFileSync(
  new URL('../src/background.js', import.meta.url),
  'utf8'
);

function flushSessionSource() {
  const start = background.indexOf('async function flushSession(tabId) {');
  const end = background.indexOf('\nfunction scheduleFlush(', start);

  assert.notEqual(start, -1, 'flushSession must exist');
  assert.notEqual(end, -1, 'scheduleFlush boundary must exist');

  return background.slice(start, end);
}

test('dual-write flush captures delta state before the first await', () => {
  const source = flushSessionSource();

  const delta = source.indexOf('const deltaQueue = getSessionRecordDelta(session);');
  const bootstrap = source.indexOf('const bootstrap = !isIndexedDbBootstrapped(session);');
  const legacy = source.indexOf('await sessionPersistence.save(tabId, session);');

  assert.ok(delta >= 0);
  assert.ok(bootstrap > delta);
  assert.ok(legacy > bootstrap);
});

test('stale session is rejected before IndexedDB write', () => {
  const source = flushSessionSource();

  const legacy = source.indexOf('await sessionPersistence.save(tabId, session);');
  const guard = source.indexOf('if (sessions.get(tabId)?.sessionId !== session.sessionId) {');
  const indexedDb = source.indexOf('await flushSessionToIndexedDb({');

  assert.ok(legacy >= 0);
  assert.ok(guard > legacy);
  assert.ok(indexedDb > guard);
});

test('bootstrap completion is recorded only for the still-current session', () => {
  const source = flushSessionSource();

  assert.match(
    source,
    /if \(bootstrap && sessions\.get\(tabId\)\?\.sessionId === session\.sessionId\) markIndexedDbBootstrapped\(session\);/
  );
});

test('IndexedDB bootstrap state is keyed by tab and session identity', () => {
  assert.match(
    background,
    /indexedDbBootstraps\.get\(session\.tabId\) === session\.sessionId/
  );
  assert.match(
    background,
    /indexedDbBootstraps\.set\(session\.tabId, session\.sessionId\)/
  );
});
