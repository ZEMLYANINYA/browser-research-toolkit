import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateParserBlueprint
} from '../src/parser-blueprint.js';

function baseSession(overrides = {}) {
  return {
    sessionId: 'session-blueprint-1',
    sequence: 10,
    pageUrl: 'https://example.test/catalog',
    network: [],
    timeline: [],
    documents: [],
    sources: [],
    correlations: [],
    ...overrides
  };
}

test('ParserBlueprint has a deterministic versioned contract', () => {
  const session = baseSession();

  const first = generateParserBlueprint(session);
  const second = generateParserBlueprint(session);

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 1);

  assert.deepEqual(first.source, {
    sessionId: 'session-blueprint-1',
    sessionSequence: 10,
    pageUrl: 'https://example.test/catalog'
  });

  assert.equal(first.transport.primary, 'unknown');
  assert.equal(first.transport.confidence, 0);
  assert.deepEqual(first.transport.evidence, []);
});

test('fetch requests produce fetch transport inference', () => {
  const session = baseSession({
    network: [
      {
        eventId: 'evt-fetch-1',
        sequence: 11,
        kind: 'network-request',
        sessionId: 'session-blueprint-1',
        documentId: 'doc-top',
        frameId: 0,
        wallTime: 1000,
        data: {
          transport: 'fetch',
          method: 'GET',
          url: 'https://example.test/api/products'
        }
      }
    ]
  });

  const blueprint = generateParserBlueprint(session);

  assert.equal(blueprint.transport.primary, 'fetch');
  assert.equal(blueprint.transport.counts.fetch, 1);
  assert.equal(blueprint.transport.counts.xhr, 0);
  assert.equal(blueprint.transport.counts.hardNavigation, 0);

  assert.deepEqual(
    blueprint.transport.evidence.map(item => item.eventId),
    ['evt-fetch-1']
  );
});

test('XHR requests produce xhr transport inference', () => {
  const session = baseSession({
    network: [
      {
        eventId: 'evt-xhr-1',
        sequence: 21,
        kind: 'network-request',
        sessionId: 'session-blueprint-1',
        documentId: 'doc-top',
        frameId: 0,
        wallTime: 2000,
        data: {
          transport: 'xhr',
          method: 'POST',
          url: 'https://example.test/search'
        }
      }
    ]
  });

  const blueprint = generateParserBlueprint(session);

  assert.equal(blueprint.transport.primary, 'xhr');
  assert.equal(blueprint.transport.counts.xhr, 1);
});

test('hard navigation is represented as document transport evidence', () => {
  const session = baseSession({
    timeline: [
      {
        eventId: 'evt-nav-1',
        sequence: 31,
        kind: 'hard-navigation',
        sessionId: 'session-blueprint-1',
        documentId: 'doc-next',
        frameId: 0,
        wallTime: 3000,
        data: {
          url: 'https://example.test/results',
          transitionType: 'link',
          isTopFrame: true
        }
      }
    ]
  });

  const blueprint = generateParserBlueprint(session);

  assert.equal(
    blueprint.transport.primary,
    'hard-navigation'
  );

  assert.equal(
    blueprint.transport.counts.hardNavigation,
    1
  );
});

test('multiple observed transport styles produce mixed inference', () => {
  const session = baseSession({
    network: [
      {
        eventId: 'evt-fetch-mixed',
        sequence: 41,
        kind: 'network-request',
        sessionId: 'session-blueprint-1',
        documentId: 'doc-top',
        frameId: 0,
        wallTime: 4000,
        data: {
          transport: 'fetch',
          method: 'GET',
          url: 'https://example.test/api/items'
        }
      }
    ],
    timeline: [
      {
        eventId: 'evt-nav-mixed',
        sequence: 42,
        kind: 'hard-navigation',
        sessionId: 'session-blueprint-1',
        documentId: 'doc-next',
        frameId: 0,
        wallTime: 4100,
        data: {
          url: 'https://example.test/item/1',
          isTopFrame: true
        }
      }
    ]
  });

  const blueprint = generateParserBlueprint(session);

  assert.equal(blueprint.transport.primary, 'mixed');
  assert.equal(blueprint.transport.counts.fetch, 1);
  assert.equal(
    blueprint.transport.counts.hardNavigation,
    1
  );
});

test('form-submit produces classic-form transport inference', () => {
  const session = baseSession({
    timeline: [
      {
        eventId: 'evt-form-1',
        sequence: 35,
        kind: 'form-submit',
        sessionId: 'session-blueprint-1',
        documentId: 'doc-top',
        frameId: 0,
        wallTime: 3500,
        data: {
          trigger: 'native',
          method: 'POST',
          action: 'https://example.test/search'
        }
      }
    ]
  });

  const blueprint = generateParserBlueprint(session);

  assert.equal(
    blueprint.transport.primary,
    'classic-form'
  );

  assert.equal(
    blueprint.transport.counts.classicForm,
    1
  );

  assert.deepEqual(
    blueprint.transport.evidence.map(item => item.eventId),
    ['evt-form-1']
  );
});
