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

function startLifecycleSource() {
  const start = background.indexOf("if (message?.type === 'BRT_START') {");
  const end = background.indexOf("if (message?.type === 'BRT_STOP') {", start);

  assert.notEqual(start, -1, 'BRT_START branch must exist');
  assert.notEqual(end, -1, 'BRT_STOP boundary must exist');

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

test('START settles the old lifecycle and flushes the new identity before capture', () => {
  const source = startLifecycleSource();

  const settle = source.indexOf('await settleFlushBeforeLifecycle(tab.id, { flushDirty: true });');
  const fresh = source.indexOf('const session = freshSession(tab.id);');
  const install = source.indexOf('sessions.set(tab.id, session);');
  const firstFlush = source.indexOf('await flushSessionNow(tab.id);', install);
  const startCommand = source.indexOf("await sendCommand(tab.id, 'START', session.generation");
  const secondFlush = source.indexOf('await flushSessionNow(tab.id);', firstFlush + 1);
  const response = source.indexOf('sendResponse({ ok: true, tabId: tab.id });', secondFlush);

  assert.ok(settle >= 0);
  assert.ok(fresh > settle);
  assert.ok(install > fresh);
  assert.ok(firstFlush > install);
  assert.ok(startCommand > firstFlush);
  assert.ok(secondFlush > startCommand);
  assert.ok(response > secondFlush);

  const immediateFlushes = source.match(/await flushSessionNow\(tab\.id\);/g) || [];
  assert.equal(immediateFlushes.length, 2);
});

test('concurrent flush callers await the active flush promise', () => {
  const source = flushSessionSource();

  assert.match(source, /return state\.promise;/);
  assert.match(source, /state\.promise = pending;/);
  assert.match(source, /if \(state\.promise === pending\) \{/);
  assert.match(source, /state\.promise = null;/);
});

test('lifecycle barrier waits for in-flight work and drains dirty tails when requested', () => {
  const source = flushSessionSource();

  const pending = source.indexOf('const pending = state.promise;');
  const awaitPending = source.indexOf('await pending;', pending);
  const dirtyLoop = source.indexOf('while (flushDirty && state.dirty && sessions.has(tabId)) {');
  const tailFlush = source.indexOf('await flushSession(tabId);', dirtyLoop);

  assert.ok(pending >= 0);
  assert.ok(awaitPending > pending);
  assert.ok(dirtyLoop > awaitPending);
  assert.ok(tailFlush > dirtyLoop);
});
