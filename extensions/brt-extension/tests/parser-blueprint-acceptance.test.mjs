import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  generateParserBlueprint
} from '../src/parser-blueprint.js';

import {
  renderParserBlueprintMarkdown
} from '../src/parser-blueprint-markdown.js';

function baseSession(overrides = {}) {
  return {
    schemaVersion: 4,
    sessionId: 'acceptance-session',
    sequence: 100,
    pageUrl: 'https://example.test/',
    timeline: [],
    network: [],
    antiBot: {
      enabled: true,
      signals: []
    },
    ...overrides
  };
}

function formSubmit({
  eventId,
  sequence,
  documentId,
  action = 'https://example.test/search',
  fields = []
}) {
  return {
    eventId,
    sequence,
    wallTime: sequence * 100,
    kind: 'form-submit',
    documentId,
    frameId: 0,
    data: {
      trigger: 'native',
      action,
      method: 'POST',
      enctype:
        'application/x-www-form-urlencoded',
      form: {
        selectorHint: 'form#search',
        name: 'search'
      },
      fieldCount: fields.length,
      fieldsTruncated: false,
      fields
    }
  };
}

test(
  'acceptance: XHR API workflow exposes architecture and safe request schema',
  () => {
    const session = baseSession({
      network: [
        {
          eventId: 'evt-api-search',
          sequence: 10,
          wallTime: 1000,
          kind: 'network-request',
          documentId: 'doc-api',
          frameId: 0,
          data: {
            transport: 'xhr',
            method: 'POST',
            url:
              'https://example.test/api/search',
            endpointFamily: '/api/search',
            body: {
              query: 'SUPER_SECRET_VALUE',
              page: 2
            }
          }
        }
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.transport.model,
      'api-driven'
    );

    assert.equal(
      blueprint.transport.primary,
      'xhr'
    );

    const step =
      blueprint.workflow.steps[0];

    assert.equal(
      step.endpointFamily,
      '/api/search'
    );

    assert.deepEqual(
      step.requestBodySchema,
      {
        kind: 'object',
        fields: ['page', 'query']
      }
    );

    assert.ok(
      Number.isFinite(step.confidence)
    );

    assert.equal(
      step.evidence.eventId,
      'evt-api-search'
    );

    const serialized =
      JSON.stringify(blueprint);

    assert.equal(
      serialized.includes(
        'SUPER_SECRET_VALUE'
      ),
      false
    );

    const markdown =
      renderParserBlueprintMarkdown(
        blueprint
      );

    assert.match(
      markdown,
      /api-driven/
    );

    assert.match(
      markdown,
      /\/api\/search/
    );

    assert.equal(
      markdown.includes(
        'SUPER_SECRET_VALUE'
      ),
      false
    );
  }
);

test(
  'acceptance: classic POST plus navigation is document-driven and correlated',
  () => {
    const session = baseSession({
      timeline: [
        formSubmit({
          eventId: 'evt-form-post',
          sequence: 10,
          documentId: 'doc-form',
          fields: [
            {
              fieldIndex: 0,
              name: 'query',
              type: 'text',
              hidden: false,
              hasValue: true
            }
          ]
        }),
        {
          eventId: 'evt-results-nav',
          sequence: 11,
          wallTime: 1100,
          kind: 'hard-navigation',
          documentId: 'doc-results',
          frameId: 0,
          data: {
            isTopFrame: true,
            url:
              'https://example.test/results'
          }
        }
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.transport.model,
      'document-driven'
    );

    assert.equal(
      blueprint.workflow.steps.length,
      2
    );

    const [
      submitStep,
      navigationStep
    ] = blueprint.workflow.steps;

    assert.equal(
      submitStep.transport,
      'classic-form'
    );

    assert.equal(
      navigationStep.transport,
      'document'
    );

    assert.equal(
      navigationStep
        .relationshipToPrevious
        ?.type,
      'observed-after-form-submit'
    );

    assert.equal(
      navigationStep
        .relationshipToPrevious
        ?.previousStepIndex,
      0
    );

    assert.ok(
      Number.isFinite(
        navigationStep
          .relationshipToPrevious
          ?.confidence
      )
    );

    assert.deepEqual(
      navigationStep
        .relationshipToPrevious
        ?.evidence
        ?.map(item => item.eventId),
      [
        'evt-form-post',
        'evt-results-nav'
      ]
    );
  }
);

test(
  'acceptance: dynamic hidden view-state fields remain non-constant and classified',
  () => {
    const session = baseSession({
      timeline: [
        formSubmit({
          eventId: 'evt-form-a',
          sequence: 10,
          documentId: 'doc-a',
          fields: [
            {
              fieldIndex: 0,
              name: '__VIEWSTATE_a1',
              type: 'hidden',
              hidden: true,
              hasValue: true,
              value:
                'SHOULD_NEVER_APPEAR_A'
            }
          ]
        }),
        formSubmit({
          eventId: 'evt-form-b',
          sequence: 20,
          documentId: 'doc-b',
          fields: [
            {
              fieldIndex: 0,
              name: '__VIEWSTATE_b9',
              type: 'hidden',
              hidden: true,
              hasValue: true,
              value:
                'SHOULD_NEVER_APPEAR_B'
            }
          ]
        })
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    const field =
      blueprint.forms.models[0]
        .fields[0];

    assert.equal(
      field.nameStability,
      'changing'
    );

    assert.equal(
      field.stableName,
      null
    );

    assert.equal(
      field.visibility,
      'hidden'
    );

    assert.equal(
      field.generatedName,
      true
    );

    assert.equal(
      field.role,
      'probable-view-state'
    );

    assert.equal(
      field.stateScope,
      'probable-document'
    );

    assert.ok(
      Number.isFinite(
        field.confidence
      )
    );

    assert.equal(
      field.evidence.length,
      2
    );

    const serialized =
      JSON.stringify(blueprint);

    assert.equal(
      serialized.includes(
        'SHOULD_NEVER_APPEAR_A'
      ),
      false
    );

    assert.equal(
      serialized.includes(
        'SHOULD_NEVER_APPEAR_B'
      ),
      false
    );
  }
);

test(
  'acceptance: analytics and protection stay separate on the same page',
  () => {
    const session = baseSession({
      network: [
        {
          eventId: 'evt-ga',
          sequence: 10,
          wallTime: 1000,
          kind: 'network-request',
          documentId: 'doc-signals',
          frameId: 0,
          data: {
            transport: 'beacon',
            method: 'POST',
            url:
              'https://www.google-analytics.com/g/collect',
            classification: 'analytics'
          }
        }
      ],

      antiBot: {
        enabled: true,
        signals: [
          {
            signalId: 'sig-cf',
            firstSequence: 20,
            kind: 'network-response',
            documentId: 'doc-signals',
            categories: [
              'cloudflare',
              'challenge'
            ],
            confidence: 0.96,
            endpointMatches: [
              'cloudflare-challenge-platform'
            ],
            summary: {
              url:
                'https://example.test/cdn-cgi/challenge-platform/',
              transport: 'fetch',
              method: 'GET',
              status: 403
            }
          }
        ]
      }
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.signals.analytics.length,
      1
    );

    assert.equal(
      blueprint.signals.protection.length,
      1
    );

    assert.equal(
      blueprint.signals.analytics[0]
        .classification,
      'analytics'
    );

    assert.ok(
      blueprint.signals.protection[0]
        .categories.includes(
          'challenge'
        )
    );
  }
);

test(
  'acceptance: load-balancer affinity cookies are identified without values',
  () => {
    const session = baseSession({
      network: [
        {
          eventId: 'evt-affinity',
          sequence: 10,
          wallTime: 1000,
          kind: 'network-response',
          documentId: 'doc-affinity',
          frameId: 0,
          data: {
            url:
              'https://example.test/',
            cookies:
              'BIGipServerpool_web=10.0.0.1.1234; Path=/'
          }
        }
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    const carrier =
      blueprint.stateCarriers.find(
        item =>
          item.type === 'cookie' &&
          item.name ===
            'BIGipServerpool_web'
      );

    assert.ok(carrier);

    assert.equal(
      carrier.role,
      'probable-load-balancer-affinity'
    );

    assert.ok(
      Number.isFinite(
        carrier.confidence
      )
    );

    const serialized =
      JSON.stringify(carrier);

    assert.equal(
      serialized.includes(
        '10.0.0.1.1234'
      ),
      false
    );
  }
);

test(
  'acceptance: canonical ordering ignores missing numeric metadata and locale',
  () => {
    const session = baseSession({
      network: [
        {
          eventId: 'evt-missing-sequence',
          sequence: null,
          wallTime: null,
          kind: 'network-request',
          documentId: 'doc-order',
          frameId: 0,
          data: {
            transport: 'fetch',
            method: 'GET',
            url:
              'https://example.test/late'
          }
        },
        {
          eventId: 'evt-real-sequence',
          sequence: 5,
          wallTime: 500,
          kind: 'network-request',
          documentId: 'doc-order',
          frameId: 0,
          data: {
            transport: 'fetch',
            method: 'GET',
            url:
              'https://example.test/first'
          }
        }
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.workflow.steps[0]
        .evidence.eventId,
      'evt-real-sequence'
    );

    const source =
      fs.readFileSync(
        new URL(
          '../src/parser-blueprint.js',
          import.meta.url
        ),
        'utf8'
      );

    assert.doesNotMatch(
      source,
      /\.localeCompare\s*\(/
    );
  }
);
