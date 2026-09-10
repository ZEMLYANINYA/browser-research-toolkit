import test from 'node:test';
import assert from 'node:assert/strict';

import {
  redactExtensionSourceText
} from '../../dist/shared/sensitivity.js';

const LEGACY_SOURCE_PATTERN =
  /(authorization|token|secret|password|cookie|csrf|xsrf|api[_-]?key|session(?:id)?|signature)\s*["']?\s*[:=]\s*["']?([^\s,&"'}]+)/gi;

function legacySourceRedact(value) {
  return String(value ?? '').replace(
    LEGACY_SOURCE_PATTERN,
    '$1=[REDACTED]'
  );
}

test('extension source redactor preserves the legacy source-code policy', () => {
  const samples = [
    'token="secret-value"; safe="keep"; csrf = abc123;',
    'authorization: Bearer123, sessionid = xyz, signature="sig";',
    'password = hello; cookie: abc; api_key="123";',
    'const config = { secret: "abc", xsrf: tokenValue };',
    'safe = "value"; ordinary = 123;',
    '',
    null,
    undefined
  ];

  for (const sample of samples) {
    assert.equal(
      redactExtensionSourceText(sample),
      legacySourceRedact(sample),
      String(sample)
    );
  }
});

test('extension source redactor preserves narrower source identifiers and legacy token substring behavior', () => {
  const source =
    'client_id="public-client"; device_id="device-marker";';

  assert.equal(
    redactExtensionSourceText(source),
    legacySourceRedact(source)
  );

  assert.equal(
    redactExtensionSourceText(source),
    source
  );

  const legacyNearMatch =
    'refresh_token="value";';

  assert.equal(
    redactExtensionSourceText(legacyNearMatch),
    legacySourceRedact(legacyNearMatch)
  );

  assert.equal(
    redactExtensionSourceText(legacyNearMatch),
    'refresh_token=[REDACTED]";'
  );
});
