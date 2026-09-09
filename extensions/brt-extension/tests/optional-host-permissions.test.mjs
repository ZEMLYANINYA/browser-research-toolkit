import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const background = fs.readFileSync(
  new URL('../src/background.js', import.meta.url),
  'utf8'
);

const panel = fs.readFileSync(
  new URL('../ui/panel.js', import.meta.url),
  'utf8'
);

const protocol = fs.readFileSync(
  new URL('../src/protocol.js', import.meta.url),
  'utf8'
);

test('third-party source hosts use a session allowlist', () => {
  assert.match(
    background,
    /thirdPartySourceHosts:\s*\[\]/
  );

  assert.match(
    background,
    /sessionAllowsThirdPartySourceHost/
  );

  assert.match(
    background,
    /allowThirdParty:\s*thirdPartyHostAllowed/
  );
});

test('background verifies optional host permission before third-party fetch', () => {
  assert.match(
    background,
    /chrome\.permissions\.contains\s*\(\s*\{\s*origins:/
  );

  assert.match(
    background,
    /host-permission-required/
  );

  assert.match(
    background,
    /source-host-permission-required/
  );
});

test('permission request stays in an explicit source UI click handler', () => {
  assert.match(
    panel,
    /allowSourceHostBtn/
  );

  assert.match(
    panel,
    /chrome\.permissions\.request\s*\(\s*\{\s*origins:/
  );

  assert.match(
    panel,
    /BRT_SET_SOURCE_HOST_PERMISSION/
  );
});

test('permission denial remains an explicit degraded state', () => {
  assert.match(
    background,
    /optional-host-permission-denied/
  );

  assert.match(
    background,
    /optional-host-permission-granted/
  );
});

test('source permission runtime message is validated', () => {
  assert.match(
    protocol,
    /BRT_SET_SOURCE_HOST_PERMISSION/
  );

  assert.match(
    protocol,
    /typeof message\.granted !== 'boolean'/
  );
});

test('source evidence UI does not render page-controlled data through innerHTML', () => {
  const start = panel.indexOf('function renderSources(session)');
  const end = panel.indexOf('function renderSession(session)', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const renderSources = panel.slice(start, end);

  assert.doesNotMatch(
    renderSources,
    /\.innerHTML\s*=/
  );

  assert.match(
    renderSources,
    /textContent\s*=/
  );

  assert.match(
    renderSources,
    /replaceChildren\s*\(/
  );
});
