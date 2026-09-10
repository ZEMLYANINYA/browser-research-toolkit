import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const background = fs.readFileSync(
  new URL('../src/background.js', import.meta.url),
  'utf8'
);

const manifest = JSON.parse(
  fs.readFileSync(
    new URL('../manifest.json', import.meta.url),
    'utf8'
  )
);

test('capture scripts are not declaratively injected', () => {
  assert.equal(manifest.content_scripts, undefined);
});

test('initial START injects only the isolated bridge into all existing frames', () => {
  assert.match(
    background,
    /return\s+\{\s*tabId,\s*allFrames:\s*true\s*\}/
  );

  assert.match(
    background,
    /await\s+injectBridge\(tab\.id\)/
  );

  assert.doesNotMatch(
    background,
    /injectCaptureScripts/
  );
});

test('hard navigation reinjects bridge only into the committed document', () => {
  assert.match(
    background,
    /await\s+injectBridge\(\s*details\.tabId,\s*details\.frameId,\s*details\.documentId\s*\|\|\s*null\s*\)/
  );
});

test('bridge-ready recovery targets the announcing frame', () => {
  assert.match(
    background,
    /const\s+frameId\s*=\s*Number\.isInteger\(sender\.frameId\)/
  );

  assert.match(
    background,
    /await\s+injectAgent\(\s*tabId,\s*frameId,\s*documentId\s*\)/
  );
});

test('page agent remains MAIN-world and bridge remains isolated-world', () => {
  assert.match(
    background,
    /files:\s*\['dist\/page-agent\.js'\][\s\S]*?world:\s*'MAIN'/
  );

  assert.match(
    background,
    /files:\s*\['src\/content-bridge\.js'\]/
  );
});

test('transient removed-frame races do not become injection failures', () => {
  assert.match(
    background,
    /const\s+transientFrameRace\s*=/
  );

  assert.match(
    background,
    /frame with \(\?:id \)\?\\d\+ was removed/
  );

  assert.match(
    background,
    /no frame with id \\d\+/
  );

  assert.match(
    background,
    /no document with id/
  );

  assert.match(
    background,
    /if\s*\(!transientFrameRace\)[\s\S]*on-demand-bridge-injection-failed/,
    'only non-transient injection failures should become diagnostics'
  );
});

test('MAIN-world agent does not expose a public lifecycle global', () => {
  const agent = fs.readFileSync(
    new URL('../src/page-agent.js', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(
    agent,
    /__BRT_LAB_AGENT_V01__/
  );

  assert.match(
    agent,
    /function\s+onExtensionMessage\s*\(event\)/
  );

  assert.match(
    agent,
    /removeEventListener\s*\(\s*['"]message['"]\s*,\s*onExtensionMessage/
  );
});

test('isolated bridge is idempotent and tears down on STOP', () => {
  const bridge = fs.readFileSync(
    new URL('../src/content-bridge.js', import.meta.url),
    'utf8'
  );

  assert.match(
    bridge,
    /__BRT_ISOLATED_BRIDGE_V01__/
  );

  assert.match(
    bridge,
    /globalThis\[BRIDGE_KEY\]/
  );

  assert.match(
    bridge,
    /message\.payload\?\.command\s*===\s*['"]STOP['"]/
  );

  assert.match(
    bridge,
    /stopInvalidatedBridge\(\)/
  );
});

test('bridge-ready requires the current live capture session', () => {
  assert.match(
    background,
    /function\s+isCurrentLiveCaptureSession\s*\(tabId,\s*session\)/
  );

  assert.match(
    background,
    /sessions\.get\(tabId\)\s*===\s*session/
  );

  assert.match(
    background,
    /session\?\.stopRequested\s*!==\s*true/
  );

  assert.match(
    background,
    /if\s*\(!isCurrentLiveCaptureSession\(tabId,\s*session\)\)/
  );
});

test('bridge-ready rechecks lifecycle after asynchronous agent injection', () => {
  const readyStart = background.indexOf(
    "if (message?.type === 'BRT_BRIDGE_READY')"
  );

  assert.ok(readyStart >= 0);

  const readyEnd = background.indexOf(
    "if (message?.type === 'BRT_GET_ACTIVE_TAB')",
    readyStart
  );

  assert.ok(readyEnd > readyStart);

  const block = background.slice(
    readyStart,
    readyEnd
  );

  const injectMatch = block.match(
    /await\s+injectAgent\(\s*tabId,\s*frameId,\s*documentId\s*\)/
  );

  assert.ok(injectMatch);

  const injectAt = block.indexOf(
    injectMatch[0]
  );

  const afterInjection = block.slice(injectAt);

  assert.match(
    afterInjection,
    /isCurrentLiveCaptureSession\(tabId,\s*session\)/
  );

  assert.match(
    afterInjection,
    /sendCommand\([\s\S]*?'STOP'/
  );
});

test('STOP becomes authoritative before awaiting frame teardown', () => {
  const stopStart = background.indexOf(
    "if (message?.type === 'BRT_STOP')"
  );

  assert.ok(stopStart >= 0);

  const stopEnd = background.indexOf(
    "if (message?.type === 'BRT_GET_SESSION')",
    stopStart
  );

  assert.ok(stopEnd > stopStart);

  const block = background.slice(
    stopStart,
    stopEnd
  );

  const stoppedAt = block.indexOf(
    'session.running = false'
  );

  const sendStopAt = block.indexOf(
    "await sendCommand(tab.id, 'STOP', generation)"
  );

  assert.ok(stoppedAt >= 0);
  assert.ok(sendStopAt >= 0);

  assert.ok(
    stoppedAt < sendStopAt,
    'running=false must be visible before STOP delivery awaits'
  );
});

test('broad web host access is optional rather than mandatory', () => {
  assert.equal(
    manifest.host_permissions,
    undefined
  );

  assert.deepEqual(
    manifest.optional_host_permissions,
    [
      'http://*/*',
      'https://*/*'
    ]
  );

  assert.ok(
    manifest.permissions.includes('activeTab')
  );

  assert.ok(
    manifest.permissions.includes('scripting')
  );
});


test('preserveSession false does not block the initial bridge handshake', () => {
  const helperStart = background.indexOf(
    'function isCurrentLiveCaptureSession(tabId, session)'
  );

  assert.ok(helperStart >= 0);

  const helperEnd = background.indexOf(
    'async function attachDeepMode',
    helperStart
  );

  assert.ok(helperEnd > helperStart);

  const helper = background.slice(
    helperStart,
    helperEnd
  );

  assert.doesNotMatch(
    helper,
    /preserveSession/
  );

  assert.match(
    helper,
    /session\?\.running === true/
  );

  assert.match(
    helper,
    /session\?\.stopRequested !== true/
  );

  assert.match(
    helper,
    /session\?\.importedReadOnly !== true/
  );

  assert.match(
    background,
    /if \(!session\.running \|\| !session\.preserveSession \|\| session\.importedReadOnly\) return;/
  );
});

test('bridge-ready injection is bound to the announcing document', () => {
  assert.match(
    background,
    /const\s+documentId\s*=\s*typeof\s+sender\.documentId\s*===\s*['"]string['"]/
  );

  assert.match(
    background,
    /await\s+injectAgent\(\s*tabId,\s*frameId,\s*documentId\s*\)/
  );

  assert.match(
    background,
    /documentIds:\s*\[documentId\]/
  );
});

test('bridge-ready commands are bound to the announcing document', () => {
  const readyStart = background.indexOf(
    "if (message?.type === 'BRT_BRIDGE_READY')"
  );

  assert.ok(readyStart >= 0);

  const readyEnd = background.indexOf(
    "if (message?.type === 'BRT_GET_ACTIVE_TAB')",
    readyStart
  );

  assert.ok(readyEnd > readyStart);

  const block = background.slice(
    readyStart,
    readyEnd
  );

  assert.match(
    block,
    /sendCommand\([\s\S]*?'START'[\s\S]*?frameId,\s*documentId/
  );

  assert.match(
    block,
    /sendCommand\([\s\S]*?'STOP'[\s\S]*?frameId,\s*documentId/
  );
});

test('top-frame reinjection failure cannot leave capture reported as running', () => {
  const navigationStart = background.indexOf(
    'chrome.webNavigation?.onCommitted?.addListener'
  );

  assert.ok(navigationStart >= 0);

  const navigationEnd = background.indexOf(
    'function sanitizeNavigationUrl',
    navigationStart
  );

  assert.ok(navigationEnd > navigationStart);

  const block = background.slice(
    navigationStart,
    navigationEnd
  );

  assert.match(
    block,
    /if\s*\(navigation\.isTopFrame\)/
  );

  assert.match(
    block,
    /session\.stopRequested\s*=\s*true/
  );

  assert.match(
    block,
    /session\.running\s*=\s*false/
  );

  assert.match(
    block,
    /session\.runState\s*=\s*['"]interrupted['"]/
  );

  assert.match(
    block,
    /capture-continuity-lost/
  );
});

test('subframe reinjection failure does not interrupt the whole session', () => {
  const navigationStart = background.indexOf(
    'chrome.webNavigation?.onCommitted?.addListener'
  );

  assert.ok(navigationStart >= 0);

  const navigationEnd = background.indexOf(
    'function sanitizeNavigationUrl',
    navigationStart
  );

  const block = background.slice(
    navigationStart,
    navigationEnd
  );

  const fatalStart = block.indexOf(
    'if (navigation.isTopFrame)'
  );

  assert.ok(fatalStart >= 0);

  const fatalBlock = block.slice(fatalStart);

  assert.match(
    fatalBlock,
    /session\.running\s*=\s*false/
  );
});

test('bridge-ready watch replay remains top-frame only', () => {
  const readyStart = background.indexOf(
    "if (message?.type === 'BRT_BRIDGE_READY')"
  );

  assert.ok(readyStart >= 0);

  const readyEnd = background.indexOf(
    "if (message?.type === 'BRT_GET_ACTIVE_TAB')",
    readyStart
  );

  assert.ok(readyEnd > readyStart);

  const block = background.slice(
    readyStart,
    readyEnd
  );

  assert.match(
    block,
    /if\s*\(frameId\s*===\s*0\)[\s\S]*?'WATCH_ADD'/
  );
});

test('Deep-mode attachment is serialized per tab', () => {
  assert.match(
    background,
    /const\s+cdpAttachInFlight\s*=\s*new Map\(\)/
  );

  const attachStart = background.indexOf(
    'async function attachDeepMode(tabId, session)'
  );

  assert.ok(attachStart >= 0);

  const attachEnd = background.indexOf(
    'async function detachDeepMode',
    attachStart
  );

  assert.ok(attachEnd > attachStart);

  const block = background.slice(
    attachStart,
    attachEnd
  );

  assert.match(
    block,
    /cdpAttachInFlight\.get\(tabId\)/
  );

  assert.match(
    block,
    /cdpAttachInFlight\.set\([\s\S]*?tabId,[\s\S]*?pending/
  );

  assert.match(
    block,
    /cdpAttachInFlight\.delete\(tabId\)/
  );

  assert.match(
    block,
    /return\s+existing/
  );
});
