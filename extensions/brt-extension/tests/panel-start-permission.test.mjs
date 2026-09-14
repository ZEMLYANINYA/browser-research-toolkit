import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panelHtmlUrl = new URL('../ui/panel.html', import.meta.url);
const bootstrapUrl = new URL('../ui/panel-bootstrap.js', import.meta.url);

test('panel wires the capture-origin guard before the existing START handler', async () => {
  const html = await readFile(panelHtmlUrl, 'utf8');

  const bootstrapIndex = html.indexOf('panel-bootstrap.js');
  const panelIndex = html.indexOf('panel.js');

  assert.ok(bootstrapIndex >= 0);
  assert.ok(panelIndex > bootstrapIndex);
  assert.match(html, /id="extensionVersion"/);
  assert.doesNotMatch(html, /v0\.5\.0/);
});

test('capture-origin guard blocks START until explicit host access is granted', async () => {
  const source = await readFile(bootstrapUrl, 'utf8');

  const stopIndex = source.indexOf('event.stopImmediatePropagation()');
  const requestIndex = source.indexOf('requestCaptureOriginPermission(chrome, snapshot.url)');
  const exactTabIndex = source.indexOf('chrome.tabs.get(snapshot.id)');
  const replayIndex = source.indexOf('startButton.click()');

  assert.ok(stopIndex >= 0);
  assert.ok(requestIndex > stopIndex);
  assert.ok(exactTabIndex > requestIndex);
  assert.ok(replayIndex > exactTabIndex);
  assert.match(source, /if \(!result\.granted\)/);
  assert.match(source, /currentTab\?\.active !== true/);
  assert.match(source, /currentTab\?\.windowId !== snapshot\.windowId/);
  assert.match(source, /currentPattern !== result\.originPattern/);
  assert.match(source, /Capture not started/);
});

test('post-permission START recheck is bound to the approved tab instead of current-window focus', async () => {
  const source = await readFile(bootstrapUrl, 'utf8');
  const requestIndex = source.indexOf('requestCaptureOriginPermission(chrome, snapshot.url)');
  const postGrantSource = source.slice(requestIndex);

  assert.match(postGrantSource, /chrome\.tabs\.get\(snapshot\.id\)/);
  assert.doesNotMatch(
    postGrantSource,
    /chrome\.tabs\.query\(\{\s*active:\s*true,\s*currentWindow:\s*true\s*\}\)/
  );
  assert.match(source, /if \(startInFlight\) return;/);
});
