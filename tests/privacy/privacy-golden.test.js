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
    fs.readFileSync(path.join(here, relativePath), 'utf8')
  );
}

function makeSanitizer() {
  return new Sanitizer({
    ...DEFAULT_CONFIG,
    redactSensitive: true
  });
}

const urlCases = readJson('fixtures/urls/cases.json');
const headerCases = readJson('fixtures/headers/cases.json');
const objectCases = readJson('fixtures/json/object-cases.json');
const bodyCases = readJson('fixtures/json/body-cases.json');
const formCases = readJson('fixtures/forms/cases.json');
const graphqlCases = readJson('fixtures/graphql/cases.json');
const encodedCases = readJson('fixtures/encoded/cases.json');
const unicodeCases = readJson('fixtures/unicode/cases.json');
const oversizedCases = readJson('fixtures/oversized/cases.json');
const regressionCases =
  readJson('fixtures/regressions/google-maps-place-details.json');

for (const fixture of urlCases) {
  test(`privacy golden URL: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();
    assert.equal(
      sanitizer.sanitizeUrl(fixture.input),
      fixture.expected
    );
  });
}

for (const fixture of headerCases) {
  test(`privacy golden headers: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();
    assert.deepEqual(
      sanitizer.sanitizeHeaders(fixture.input),
      fixture.expected
    );
  });
}

for (const fixture of objectCases) {
  test(`privacy golden object: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();
    assert.deepEqual(
      sanitizer.sanitizeObject(fixture.input),
      fixture.expected
    );
  });
}

for (const fixture of bodyCases) {
  test(`privacy golden body: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();
    assert.deepEqual(
      sanitizer.sanitizeBody(fixture.input, fixture.url),
      fixture.expected
    );
  });
}

for (const fixture of formCases) {
  test(`privacy golden form: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();
    assert.equal(
      sanitizer.sanitizeBody(fixture.input, fixture.url),
      fixture.expected
    );
  });
}

for (const fixture of graphqlCases) {
  test(`privacy golden GraphQL: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();
    assert.equal(
      sanitizer.sanitizeBody(fixture.input, fixture.url),
      fixture.expected
    );
  });
}

for (const fixture of encodedCases) {
  test(`privacy golden encoded: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();
    assert.equal(
      sanitizer.sanitizeBody(fixture.input, fixture.url),
      fixture.expected
    );
  });
}

for (const fixture of unicodeCases) {
  test(`privacy golden Unicode: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();

    const actual =
      typeof fixture.input === 'string'
        ? sanitizer.sanitizeBody(fixture.input, fixture.url)
        : sanitizer.sanitizeObject(fixture.input);

    assert.deepEqual(actual, fixture.expected);
  });
}

for (const fixture of oversizedCases) {
  test(`privacy golden oversized: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();

    const input =
      fixture.character.repeat(fixture.length);

    const actual =
      sanitizer.sanitizeBody(
        input,
        'https://example.test/api/data'
      );

    assert.equal(actual.length, fixture.expectedLength);
    assert.ok(actual.endsWith(fixture.expectedSuffix));
    assert.equal(
      actual.slice(0, 500),
      fixture.character.repeat(500)
    );
  });
}

for (const fixture of regressionCases) {
  test(`privacy regression: ${fixture.id}`, () => {
    const sanitizer = makeSanitizer();

    assert.deepEqual(
      sanitizer.sanitizeObject(fixture.input),
      fixture.expected
    );
  });
}
