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


test(
  'acceptance: bootstrap navigation does not make an XHR workflow mixed',
  () => {
    const session = baseSession({
      timeline: [
        {
          eventId: 'evt-bootstrap',
          sequence: 5,
          wallTime: 500,
          kind: 'hard-navigation',
          documentId: 'doc-api',
          frameId: 0,
          data: {
            isTopFrame: true,
            transitionType: 'reload',
            url: 'https://example.test/api'
          }
        }
      ],
      network: [
        {
          eventId: 'evt-xhr',
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
            body: {
              query: 'VALUE_NOT_FOR_BLUEPRINT',
              page: 2
            }
          }
        }
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    // Counts remain factual.
    assert.equal(
      blueprint.transport.counts.xhr,
      1
    );

    assert.equal(
      blueprint.transport.counts.hardNavigation,
      1
    );

    // Architecture ignores the bootstrap document load.
    assert.equal(
      blueprint.transport.primary,
      'xhr'
    );

    assert.equal(
      blueprint.transport.model,
      'api-driven'
    );
  }
);


test(
  'acceptance: Markdown exposes workflow relationship inference',
  () => {
    const markdown =
      renderParserBlueprintMarkdown({
        schemaVersion: 1,

        source: {
          sessionId: 'session-render-relation',
          sessionSequence: 12,
          pageUrl:
            'https://example.test/results'
        },

        transport: {
          primary: 'classic-form',
          model: 'document-driven',
          counts: {
            fetch: 0,
            xhr: 0,
            classicForm: 1,
            hardNavigation: 1
          },
          confidence: 0.9,
          evidence: []
        },

        workflow: {
          steps: [
            {
              stepIndex: 0,
              kind: 'form-submit',
              method: 'POST',
              target:
                'https://example.test/results',
              endpointFamily: '/results',
              requestBodySchema: {
                kind: 'form',
                fields: ['query']
              },
              transport: 'classic-form',
              trigger: 'native',
              documentId: 'doc-before',
              frameId: 0,
              confidence: 0.98,
              evidence: {
                eventId: 'evt-form',
                sequence: 10,
                kind: 'form-submit',
                documentId: 'doc-before',
                frameId: 0,
                reason:
                  'observed form submission'
              }
            },
            {
              stepIndex: 1,
              kind: 'hard-navigation',
              method: null,
              target:
                'https://example.test/results',
              endpointFamily: '/results',
              requestBodySchema: null,
              transport: 'document',
              trigger: null,
              documentId: 'doc-after',
              frameId: 0,
              confidence: 0.98,
              evidence: {
                eventId: 'evt-nav',
                sequence: 11,
                kind: 'hard-navigation',
                documentId: 'doc-after',
                frameId: 0,
                reason:
                  'observed hard navigation'
              },

              relationshipToPrevious: {
                type:
                  'observed-after-form-submit',
                previousStepIndex: 0,
                confidence: 0.85,
                evidence: [
                  {
                    eventId: 'evt-form',
                    sequence: 10,
                    kind: 'form-submit',
                    documentId: 'doc-before',
                    frameId: 0,
                    reason:
                      'observed form submission'
                  },
                  {
                    eventId: 'evt-nav',
                    sequence: 11,
                    kind: 'hard-navigation',
                    documentId: 'doc-after',
                    frameId: 0,
                    reason:
                      'observed hard navigation'
                  }
                ]
              }
            }
          ]
        },

        forms: {
          status: 'not-observed',
          valueComparison: 'presence-only',
          observations: [],
          models: []
        },

        stateCarriers: [],

        signals: {
          protection: [],
          analytics: [],
          infrastructure: [],
          unknown: []
        },

        implications: [],
        gaps: []
      });

    assert.match(
      markdown,
      /observed-after-form-submit/
    );

    assert.match(
      markdown,
      /Previous step: 0/
    );

    assert.match(
      markdown,
      /Relationship confidence: 0.85/
    );

    assert.match(
      markdown,
      /evt-form/
    );

    assert.match(
      markdown,
      /evt-nav/
    );
  }
);

test(
  'acceptance: Markdown exposes form and carrier inference metadata',
  () => {
    const markdown =
      renderParserBlueprintMarkdown({
        schemaVersion: 1,

        source: {
          sessionId: 'session-render-form',
          sessionSequence: 20,
          pageUrl:
            'https://example.test/form'
        },

        transport: {
          primary: 'classic-form',
          model: 'document-driven',
          counts: {
            fetch: 0,
            xhr: 0,
            classicForm: 1,
            hardNavigation: 0
          },
          confidence: 0.9,
          evidence: []
        },

        workflow: {
          steps: []
        },

        forms: {
          status: 'observed',
          valueComparison: 'presence-only',
          observations: [],
          models: [
            {
              modelId: 'form-1',
              frameId: 0,
              selectorHint: 'form#search',
              formName: 'search',
              action:
                'https://example.test/results',
              method: 'POST',
              enctype:
                'application/x-www-form-urlencoded',
              observationCount: 2,

              fields: [
                {
                  fieldIndex: 0,
                  observedNames: [
                    '__VIEWSTATE_a',
                    '__VIEWSTATE_b'
                  ],
                  nameStability: 'changing',
                  stableName: null,
                  observedTypes: ['hidden'],
                  typeStability: 'stable',
                  stableType: 'hidden',
                  visibility: 'hidden',
                  generatedName: true,
                  role:
                    'probable-view-state',
                  stateScope:
                    'probable-document',
                  confidence: 0.94,
                  observedIn: 2,
                  missingFrom: 0,
                  valuePresence: {
                    present: 2,
                    empty: 0,
                    stability: 'stable'
                  },
                  evidence: []
                }
              ],

              evidence: []
            }
          ]
        },

        stateCarriers: [
          {
            type: 'cookie',
            name: 'BIGipServerpool_web',
            role:
              'probable-load-balancer-affinity',
            confidence: 0.9,
            evidence: []
          }
        ],

        signals: {
          protection: [],
          analytics: [],
          infrastructure: [],
          unknown: []
        },

        implications: [],
        gaps: []
      });

    assert.match(
      markdown,
      /Visibility:.*hidden/
    );

    assert.match(
      markdown,
      /Generated name:.*yes/
    );

    assert.match(
      markdown,
      /Role:.*probable-view-state/
    );

    assert.match(
      markdown,
      /State scope:.*probable-document/
    );

    assert.match(
      markdown,
      /Field confidence: 0.94/
    );

    assert.match(
      markdown,
      /probable-load-balancer-affinity/
    );
  }
);


test(
  'acceptance: subframe-only XHR does not redefine top-level transport',
  () => {
    const session = baseSession({
      timeline: [
        {
          eventId: 'evt-top-nav',
          sequence: 5,
          wallTime: 500,
          kind: 'hard-navigation',
          documentId: 'doc-top',
          frameId: 0,
          data: {
            isTopFrame: true,
            transitionType: 'reload',
            url:
              'https://example.test/document'
          }
        }
      ],

      network: [
        {
          eventId: 'evt-child-xhr',
          sequence: 10,
          wallTime: 1000,
          kind: 'network-request',
          documentId: 'doc-child',
          frameId: 7,
          data: {
            transport: 'xhr',
            method: 'POST',
            url:
              'https://child.example.test/api/search',
            body: {
              query:
                'CHILD_VALUE_NOT_FOR_BLUEPRINT'
            }
          }
        }
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.transport.counts.xhr,
      0
    );

    assert.equal(
      blueprint.transport.counts.hardNavigation,
      1
    );

    assert.equal(
      blueprint.transport.primary,
      'hard-navigation'
    );

    assert.equal(
      blueprint.transport.model,
      'document-driven'
    );
  }
);


test(
  'acceptance: canceled SPA submit does not become classic-form transport',
  () => {
    const session = baseSession({
      timeline: [
        {
          eventId: 'evt-bootstrap',
          sequence: 5,
          wallTime: 500,
          kind: 'hard-navigation',
          documentId: 'doc-spa',
          frameId: 0,
          data: {
            isTopFrame: true,
            transitionType: 'reload',
            url:
              'https://example.test/search'
          }
        },

        {
          eventId: 'evt-submit-attempt',
          sequence: 10,
          wallTime: 1000,
          kind: 'form-submit',
          documentId: 'doc-spa',
          frameId: 0,
          data: {
            trigger: 'native',
            isTrusted: true,
            submissionProceeded: false,
            defaultPrevented: true,
            action:
              'https://example.test/search',
            method: 'POST',
            enctype:
              'application/x-www-form-urlencoded',
            form: {
              selectorHint: 'form#search',
              name: 'search'
            },
            fieldCount: 1,
            fieldsTruncated: false,
            fields: [
              {
                fieldIndex: 0,
                name: 'query',
                type: 'text',
                hidden: false,
                disabled: false,
                required: false,
                multiple: false,
                checked: false,
                hasValue: true
              }
            ]
          }
        }
      ],

      network: [
        {
          eventId: 'evt-spa-xhr',
          sequence: 11,
          wallTime: 1100,
          kind: 'network-request',
          documentId: 'doc-spa',
          frameId: 0,
          data: {
            transport: 'xhr',
            method: 'POST',
            url:
              'https://example.test/api/search',
            body: {
              query:
                'VALUE_NOT_FOR_BLUEPRINT'
            }
          }
        }
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.transport.counts.classicForm,
      0
    );

    assert.equal(
      blueprint.transport.counts.xhr,
      1
    );

    assert.equal(
      blueprint.transport.primary,
      'xhr'
    );

    assert.equal(
      blueprint.transport.model,
      'api-driven'
    );

    const submitStep =
      blueprint.workflow.steps.find(
        step =>
          step.evidence?.eventId ===
          'evt-submit-attempt'
      );

    assert.ok(submitStep);

    assert.equal(
      submitStep.submissionProceeded,
      false
    );

    assert.equal(
      submitStep.transport,
      'submit-event'
    );

    assert.equal(
      blueprint.implications.some(
        item =>
          item.id ===
          'reproduce-classic-form-submission'
      ),
      false
    );
  }
);
