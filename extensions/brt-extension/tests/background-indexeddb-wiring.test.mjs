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

function importLifecycleSource() {
  const start = background.indexOf("if (message?.type === 'BRT_IMPORT_SESSION') {");
  const end = background.indexOf('\n  })().catch(', start);

  assert.notEqual(start, -1, 'BRT_IMPORT_SESSION branch must exist');
  assert.notEqual(end, -1, 'runtime message boundary must exist');

  return background.slice(start, end);
}

function clearLifecycleSource() {
  const start = background.indexOf("if (message?.type === 'BRT_CLEAR') {");
  const end = background.indexOf("if (message?.type === 'BRT_SET_SOURCE_HOST_PERMISSION') {", start);

  assert.notEqual(start, -1, 'BRT_CLEAR branch must exist');
  assert.notEqual(end, -1, 'BRT_CLEAR branch boundary must exist');

  return background.slice(start, end);
}

test('IndexedDB flush captures delta state without rewriting the legacy session blob', () => {
  const source = flushSessionSource();

  const delta = source.indexOf('const deltaQueue = getSessionRecordDelta(session);');
  const entityDelta = source.indexOf('const entityDeltaQueue = getSessionEntityDelta(session);');
  const bootstrap = source.indexOf('const bootstrap = !isIndexedDbBootstrapped(session);');
  const indexedDb = source.indexOf('await flushSessionToIndexedDb({');

  assert.ok(delta >= 0);
  assert.ok(entityDelta > delta);
  assert.ok(bootstrap > entityDelta);
  assert.ok(indexedDb > bootstrap);
  assert.doesNotMatch(source, /sessionPersistence\.save/);
});

test('stale session is rejected before IndexedDB write', () => {
  const source = flushSessionSource();

  const guard = source.indexOf('if (sessions.get(tabId)?.sessionId !== session.sessionId) {');
  const indexedDb = source.indexOf('await flushSessionToIndexedDb({');

  assert.ok(guard >= 0);
  assert.ok(indexedDb > guard);
});

test('failed IndexedDB writes force a bounded session rebase', () => {
  const source = flushSessionSource();

  const catchStart = source.indexOf('} catch (error) {', source.indexOf('await flushSessionToIndexedDb({'));
  const failureDiagnostic = source.indexOf("diagnostic(session, 'indexeddb-write-failed'", catchStart);
  const resetRecords = source.indexOf('resetRecordDelta(tabId);', failureDiagnostic);
  const resetEntities = source.indexOf('resetEntityDelta(tabId);', resetRecords);
  const resetBootstrap = source.indexOf('resetIndexedDbBootstrap(tabId);', resetEntities);
  const rebaseDiagnostic = source.indexOf("diagnostic(session, 'indexeddb-rebase-required'", resetBootstrap);

  assert.ok(catchStart >= 0);
  assert.ok(failureDiagnostic > catchStart);
  assert.ok(resetRecords > failureDiagnostic);
  assert.ok(resetEntities > resetRecords);
  assert.ok(resetBootstrap > resetEntities);
  assert.ok(rebaseDiagnostic > resetBootstrap);
});
test('session export flushes before reading the durable IndexedDB snapshot', () => {
  const start = background.indexOf("if (message?.type === 'BRT_EXPORT_SESSION') {");
  const end = background.indexOf("if (message?.type === 'BRT_IMPORT_SESSION') {", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const source = background.slice(start, end);
  const load = source.indexOf('const session = await loadSession(tab.id);');
  const identity = source.indexOf('const expectedSessionId = session.sessionId;');
  const flush = source.indexOf('const flushResult = await flushSessionNow(tab.id);');
  const durableGuard = source.indexOf('!flushResult?.indexedDbOk');
  const recovery = source.indexOf('await recoverSessionFromIndexedDb({');
  const recoveredIdentity = source.indexOf("recovery.session?.sessionId !== expectedSessionId");

  assert.ok(load >= 0);
  assert.ok(identity > load);
  assert.ok(flush > identity);
  assert.ok(durableGuard > flush);
  assert.ok(recovery > durableGuard);
  assert.ok(recoveredIdentity > recovery);
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

test('IMPORT settles the previous lifecycle before installing and flushing the imported session', () => {
  const source = importLifecycleSource();

  const imported = source.indexOf('const imported = message.session;');
  const settle = source.indexOf('await settleFlushBeforeLifecycle(tab.id, { flushDirty: true });');
  const construct = source.indexOf('const session = { ...freshSession(tab.id), ...imported');
  const resetDelta = source.indexOf('resetRecordDelta(tab.id);');
  const resetBootstrap = source.indexOf('resetIndexedDbBootstrap(tab.id);');
  const install = source.indexOf('sessions.set(tab.id, session);');
  const flush = source.indexOf('await flushSessionNow(tab.id);', install);
  const response = source.indexOf('sendResponse({ ok: true, sessionId: session.sessionId });', flush);

  assert.ok(imported >= 0);
  assert.ok(settle > imported);
  assert.ok(construct > settle);
  assert.ok(resetDelta > construct);
  assert.ok(resetBootstrap > resetDelta);
  assert.ok(install > resetBootstrap);
  assert.ok(flush > install);
  assert.ok(response > flush);

  const immediateFlushes = source.match(/await flushSessionNow\(tab\.id\);/g) || [];
  assert.equal(immediateFlushes.length, 1);
});

test('IndexedDB retry uses a separate bounded timer and lifecycle cleanup', () => {
  assert.match(background, /INDEXEDDB_RETRY_DELAYS_MS = Object\.freeze\(\[250, 1000, 4000\]\)/);
  assert.match(background, /retryTimer: null/);
  assert.match(background, /retryAttempts: 0/);
  assert.match(background, /retrySessionId: null/);
  assert.match(background, /retryExhaustedNotified: false/);
  assert.match(background, /bindIndexedDbRetrySession\(state, session\.sessionId\)/);
  assert.match(background, /indexeddb-retry-exhausted/);

  const settleStart = background.indexOf('async function settleFlushBeforeLifecycle(tabId');
  const settleEnd = background.indexOf('async function flushSessionNow(tabId)', settleStart);
  const settleSource = background.slice(settleStart, settleEnd);

  const retryCancels = settleSource.match(/cancelIndexedDbRetry\(state\);/g) || [];
  assert.ok(retryCancels.length >= 3);
});

test('tab removal finalizes persistence before dropping session state', () => {
  const cleanupStart = background.indexOf('function cleanupRemovedTabState(tabId) {');
  const finalizerStart = background.indexOf('async function finalizeRemovedTab(tabId) {');
  const listenerStart = background.indexOf('chrome.tabs?.onRemoved?.addListener((tabId) => {');

  assert.notEqual(cleanupStart, -1);
  assert.notEqual(finalizerStart, -1);
  assert.notEqual(listenerStart, -1);

  const finalizerSource = background.slice(finalizerStart, listenerStart);
  const marker = finalizerSource.indexOf("diagnostic(session, 'tab-close-finalization'");
  const flush = finalizerSource.indexOf('await flushSessionNow(tabId);', marker);
  const finallyBlock = finalizerSource.indexOf('} finally {', flush);
  const cleanup = finalizerSource.indexOf('cleanupRemovedTabState(tabId);', finallyBlock);

  assert.ok(marker >= 0);
  assert.ok(flush > marker);
  assert.ok(finallyBlock > flush);
  assert.ok(cleanup > finallyBlock);

  const listenerSource = background.slice(listenerStart);
  assert.match(listenerSource, /void finalizeRemovedTab\(tabId\);/);
});

test('removed-tab cleanup cancels persistence timers before dropping flush state', () => {
  const start = background.indexOf('function cleanupRemovedTabState(tabId) {');
  const end = background.indexOf('async function finalizeRemovedTab(tabId) {', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const source = background.slice(start, end);
  const stateLookup = source.indexOf('const flushState = flushStates.get(tabId);');
  const normalTimer = source.indexOf('clearTimeout(flushState.timer)', stateLookup);
  const retryTimer = source.indexOf('cancelIndexedDbRetry(flushState);', stateLookup);
  const deleteState = source.indexOf('flushStates.delete(tabId);', retryTimer);

  assert.ok(stateLookup >= 0);
  assert.ok(normalTimer > stateLookup);
  assert.ok(retryTimer > normalTimer);
  assert.ok(deleteState > retryTimer);
});
test('page producer continuity is preserved alongside canonical session ordering', () => {
  assert.match(background, /observePageProducerSequence/);
  assert.match(background, /continuity: \{ pageStreams: \[\] \}/);

  const start = background.indexOf('async function handlePageEvent(tabId, payload, senderContext = {}) {');
  const end = background.indexOf('async function activeTab()', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const source = background.slice(start, end);

  assert.match(source, /const producerSequence = pageObservable/);
  assert.match(source, /payload\.sequence > 0/);
  assert.match(source, /observePageProducerSequence\(\{/);
  assert.match(source, /continuity: session\.continuity/);
  assert.match(source, /documentId: canonicalDocumentId/);
  assert.match(source, /frameId: canonicalFrameId/);
  assert.match(source, /producerSequence,/);
  assert.match(source, /diagnostic\(session, 'page-producer-sequence-gap', continuity\.gap\)/);
  assert.match(source, /diagnostic\(session, 'page-continuity-cursor-evicted'/);

  const producerField = source.indexOf('producerSequence,');
  const canonicalField = source.indexOf('sequence: canonicalSequence', producerField);
  assert.ok(producerField >= 0);
  assert.ok(canonicalField > producerField);
});
test('flush suspension blocks direct and scheduled persistence', () => {
  const flushStart = background.indexOf('async function flushSession(tabId) {');
  const flushEnd = background.indexOf('async function settleFlushBeforeLifecycle', flushStart);
  const flushSource = background.slice(flushStart, flushEnd);

  const scheduleStart = background.indexOf('function scheduleFlush(tabId, delay = 350) {');
  const scheduleEnd = background.indexOf('\nfunction diagnostic(', scheduleStart);
  const scheduleSource = background.slice(scheduleStart, scheduleEnd);

  assert.match(flushSource, /if \(state\.suspended\) return;/);
  assert.match(scheduleSource, /if \(state\.suspended\) return;/);
});

test('destructive lifecycle suspension settles persistence before fencing new flushes', () => {
  const start = background.indexOf('async function settleAndSuspendSessionFlush(tabId) {');
  const end = background.indexOf('\nfunction scheduleFlush(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const source = background.slice(start, end);
  const settle = source.indexOf('await settleFlushBeforeLifecycle(tabId, { flushDirty: false });');
  const suspend = source.indexOf('suspendSessionFlush(tabId);');

  assert.ok(settle >= 0);
  assert.ok(suspend > settle);
});

test('CLEAR keeps persistence fenced until the current session is fully deleted', () => {
  const source = clearLifecycleSource();

  const load = source.indexOf('const session = await loadSession(tab.id);');
  const captureId = source.indexOf('const sessionId = session.sessionId;');
  const fence = source.indexOf('await settleAndSuspendSessionFlush(tab.id);');
  const idbDelete = source.indexOf('await indexedDbPersistence.deleteSessionData({');
  const legacyDelete = source.indexOf('await sessionPersistence.remove(tab.id);');
  const resetDelta = source.indexOf('resetRecordDelta(tab.id);');
  const resetBootstrap = source.indexOf('resetIndexedDbBootstrap(tab.id);');
  const fresh = source.indexOf('sessions.set(tab.id, freshSession(tab.id));');
  const resume = source.indexOf('resumeSessionFlush(tab.id);', fresh);
  const response = source.indexOf('sendResponse({ ok: true });', resume);

  assert.ok(load >= 0);
  assert.ok(captureId > load);
  assert.ok(fence > captureId);
  assert.ok(idbDelete > fence);
  assert.ok(legacyDelete > idbDelete);
  assert.ok(resetDelta > legacyDelete);
  assert.ok(resetBootstrap > resetDelta);
  assert.ok(fresh > resetBootstrap);
  assert.ok(resume > fresh);
  assert.ok(response > resume);
  assert.equal(source.includes('} finally {'), false);

  assert.match(source, /sessionId\s*\n\s*\}\);/);
  assert.equal((source.match(/resumeSessionFlush\(tab\.id\);/g) || []).length, 1);
});

test('CLEAR resumes persistence only after both durable stores are deleted', () => {
  const source = clearLifecycleSource();

  const idbDelete = source.indexOf('await indexedDbPersistence.deleteSessionData({');
  const legacyDelete = source.indexOf('await sessionPersistence.remove(tab.id);');
  const fresh = source.indexOf('sessions.set(tab.id, freshSession(tab.id));');
  const resume = source.indexOf('resumeSessionFlush(tab.id);');

  assert.ok(idbDelete >= 0);
  assert.ok(legacyDelete > idbDelete);
  assert.ok(fresh > legacyDelete);
  assert.ok(resume > fresh);
  assert.equal(source.includes('} finally {'), false);
});

test('loadSession prefers IndexedDB recovery before legacy storage', () => {
  const start = background.indexOf('async function loadSession(tabId) {');
  const end = background.indexOf('\nfunction getSessionRecordDelta', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const source = background.slice(start, end);
  const recovery = source.indexOf('await recoverSessionFromIndexedDb({');
  const chooseIndexedDb = source.indexOf("recovery?.status === 'recovered'");
  const legacy = source.indexOf('await sessionPersistence.load(tabId);');
  const chooseSession = source.indexOf('const session = indexedDbSession || legacySession || freshSession(tabId);');

  assert.ok(recovery >= 0);
  assert.ok(chooseIndexedDb > recovery);
  assert.ok(legacy > chooseIndexedDb);
  assert.ok(chooseSession > legacy);
  assert.match(source, /const legacySession = indexedDbSession\s*\n\s*\? null\s*\n\s*: await sessionPersistence\.load\(tabId\);/);
});

test('loadSession marks successful IndexedDB recovery and exposes broken recovery fallback', () => {
  const start = background.indexOf('async function loadSession(tabId) {');
  const end = background.indexOf('\nfunction getSessionRecordDelta', start);
  const source = background.slice(start, end);

  const recoveredBranch = source.indexOf('if (indexedDbSession) {');
  const bootstrap = source.indexOf('markIndexedDbBootstrapped(session);', recoveredBranch);
  const recoveredDiagnostic = source.indexOf("diagnostic(session, 'indexeddb-session-recovered'", bootstrap);
  const fallbackBranch = source.indexOf("recovery.status !== 'missing'");
  const fallbackDiagnostic = source.indexOf("diagnostic(session, 'indexeddb-recovery-fallback'", fallbackBranch);

  assert.ok(recoveredBranch >= 0);
  assert.ok(bootstrap > recoveredBranch);
  assert.ok(recoveredDiagnostic > bootstrap);
  assert.ok(fallbackBranch > recoveredDiagnostic);
  assert.ok(fallbackDiagnostic > fallbackBranch);
});

test('flushSession returns the durable persistence result to lifecycle callers', () => {
  const source = flushSessionSource();

  assert.match(source, /return await pending;/);
  assert.match(source, /indexedDbOk,/);
  assert.match(source, /stale: false/);
});

test('STOP waits for immediate persistence and rejects a non-durable IndexedDB result', () => {
  const start = background.indexOf("if (message?.type === 'BRT_STOP') {");
  const end = background.indexOf("if (message?.type === 'BRT_CLEAR') {", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const source = background.slice(start, end);
  const stopped = source.indexOf("session.runState = 'stopped';");
  const detach = source.indexOf('await detachDeepMode(tab.id, session);');
  const flush = source.indexOf('const flushResult = await flushSessionNow(tab.id);');
  const guard = source.indexOf('if (!flushResult?.indexedDbOk || flushResult.stale) {');
  const response = source.indexOf('sendResponse({ ok: true });');

  assert.ok(stopped >= 0);
  assert.ok(detach > stopped);
  assert.ok(flush > detach);
  assert.ok(guard > flush);
  assert.ok(response > guard);
});

test('flushSessionNow drains an existing in-flight flush before returning', () => {
  const start = background.indexOf('async function flushSessionNow(tabId) {');
  const end = background.indexOf('\nfunction suspendSessionFlush(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const source = background.slice(start, end);
  const loop = source.indexOf('while (true) {');
  const inFlight = source.indexOf('if (state.inFlight) {', loop);
  const markDirty = source.indexOf('state.dirty = true;', inFlight);
  const awaitExisting = source.indexOf('result = await state.promise;', markDirty);
  const freshFlush = source.indexOf('result = await flushSession(tabId);', awaitExisting);
  const cleanGuard = source.indexOf('if (!state.dirty) {', freshFlush);
  const resultReturn = source.indexOf('return result;', cleanGuard);

  assert.ok(loop >= 0);
  assert.ok(inFlight > loop);
  assert.ok(markDirty > inFlight);
  assert.ok(awaitExisting > markDirty);
  assert.ok(freshFlush > awaitExisting);
  assert.ok(cleanGuard > freshFlush);
  assert.ok(resultReturn > cleanGuard);
});
