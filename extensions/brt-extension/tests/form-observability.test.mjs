import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  PAGE_EVENT_KINDS,
  validatePageEventPayload
} from '../src/protocol.js';

const pageAgent = fs.readFileSync(
  new URL('../src/page-agent.js', import.meta.url),
  'utf8'
);

const contentBridge = fs.readFileSync(
  new URL('../src/content-bridge.js', import.meta.url),
  'utf8'
);

function pageEvent(overrides = {}) {
  return {
    kind: 'form-submit',
    sequence: 1,
    generation: 1,
    runId: 'run_form_test',
    wallTime: 1000,
    eventId: 'evt_form_1',
    documentId: 'doc-form-1',
    data: {},
    ...overrides
  };
}

test('form-submit is a declared page event kind', () => {
  assert.ok(
    PAGE_EVENT_KINDS.includes('form-submit')
  );

  assert.equal(
    validatePageEventPayload(pageEvent()).ok,
    true
  );
});

test('content bridge allows form-submit events', () => {
  assert.match(
    contentBridge,
    /['"]form-submit['"]/
  );
});

test('page agent emits dedicated structured form-submit evidence', () => {
  assert.match(
    pageAgent,
    /emit\(['"]form-submit['"]/
  );

  assert.match(
    pageAgent,
    /HTMLFormElement\.prototype/
  );
});

test('page agent observes submit() and requestSubmit() paths', () => {
  assert.match(
    pageAgent,
    /requestSubmit/
  );

  assert.match(
    pageAgent,
    /state\.originals\.[A-Za-z0-9_]*formSubmit|state\.originals\.formSubmit/
  );
});

test('form evidence is schema-oriented instead of copying raw field values', () => {
  assert.match(pageAgent, /hasValue/);
  assert.match(pageAgent, /fieldIndex/);
  assert.match(pageAgent, /required/);
  assert.match(pageAgent, /disabled/);
  assert.match(pageAgent, /multiple/);
  assert.match(pageAgent, /checked/);

  assert.doesNotMatch(
    pageAgent,
    /value\s*:\s*(?:field|control|element)\.value\b/
  );
});
