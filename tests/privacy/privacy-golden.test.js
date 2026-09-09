import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Sanitizer } from '../../dist/sanitize/sanitizer.js';
import { DEFAULT_CONFIG } from '../../dist/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(
      path.join(here, relativePath),
      'utf8'
    )
  );
}

function makeSanitizer() {
  return new Sanitizer({
    ...DEFAULT_CONFIG,
    redactSensitive: true
  });
}

const urlCases =
  readJson('fixtures/urls/cases.json');

const headerCases =
  readJson('fixtures/headers/cases.json');

for (const fixture of urlCases) {
  test(`privacy golden URL: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();

    const actual =
      sanitizer.sanitizeUrl(fixture.input);

    assert.equal(
      actual,
      fixture.expected
    );
  });
}

for (const fixture of headerCases) {
  test(`privacy golden headers: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();

    const actual =
      sanitizer.sanitizeHeaders(fixture.input);

    assert.deepEqual(
      actual,
      fixture.expected
    );
  });
}
