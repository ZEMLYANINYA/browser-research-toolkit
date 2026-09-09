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

test('hard navigation reinjects bridge only into the committed frame', () => {
  assert.match(
    background,
    /await\s+injectBridge\(details\.tabId,\s*details\.frameId\)/
  );
});

test('bridge-ready recovery targets the announcing frame', () => {
  assert.match(
    background,
    /const\s+frameId\s*=\s*Number\.isInteger\(sender\.frameId\)/
  );

  assert.match(
    background,
    /await\s+injectAgent\(tabId,\s*frameId\)/
  );
});

test('page agent remains MAIN-world and bridge remains isolated-world', () => {
  assert.match(
    background,
    /files:\s*\['src\/page-agent\.js'\][\s\S]*?world:\s*'MAIN'/
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

  assert.ok(
    background.includes(
      '/frame with (?:id )?\\d+ was removed|no frame with id \\d+/i.test('
    ),
    'known removed-frame navigation races must be recognized explicitly'
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
