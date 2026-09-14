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
  const replayIndex = source.indexOf('startButton.click()');

  assert.ok(stopIndex >= 0);
  assert.ok(requestIndex > stopIndex);
  assert.ok(replayIndex > requestIndex);
  assert.match(source, /if \(!result\.granted\)/);
  assert.match(source, /Capture not started/);
});
