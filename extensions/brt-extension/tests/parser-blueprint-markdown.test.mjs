import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderParserBlueprintMarkdown
} from '../src/parser-blueprint-markdown.js';

function blueprint(overrides = {}) {
  return {
    schemaVersion: 1,

    source: {
      sessionId: 'session-1',
      sessionSequence: 42,
      pageUrl: 'https://example.test/search'
    },

    transport: {
      primary: 'mixed',
      counts: {
        fetch: 1,
        xhr: 0,
        classicForm: 1,
        hardNavigation: 1
      },
      confidence: 0.85,
      evidence: [
        {
          eventId: 'evt-fetch',
          sequence: 20,
          kind: 'network-request',
          documentId: 'doc-1',
          frameId: 0,
          reason: 'observed fetch request'
        }
      ]
    },

    workflow: {
      steps: [
        {
          stepIndex: 0,
          kind: 'form-submit',
          method: 'POST',
          target:
            'https://example.test/search',
          transport: 'classic-form',
          trigger: 'native',
          documentId: 'doc-1',
          frameId: 0,
          evidence: {
            eventId: 'evt-form',
            sequence: 10,
            kind: 'form-submit',
            documentId: 'doc-1',
            frameId: 0,
            reason:
              'observed form submission'
          }
        }
      ]
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
            'https://example.test/search',
          method: 'POST',
          enctype:
            'application/x-www-form-urlencoded',
          observationCount: 2,

          fields: [
            {
              fieldIndex: 0,
              observedNames: ['query'],
              nameStability: 'stable',
              stableName: 'query',
              observedTypes: ['text'],
              typeStability: 'stable',
              stableType: 'text',
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
        name: 'sessionid',
        documentId: 'doc-1',
        frameId: 0,
        confidence: 0.9,
        evidence: [
          {
            eventId: 'evt-cookie',
            sequence: 15,
            kind: 'network-response',
            documentId: 'doc-1',
            frameId: 0,
            reason:
              'observed cookie carrier name'
          }
        ]
      }
    ],

    signals: {
      protection: [
        {
          provider: 'Cloudflare',
          categories: [
            'challenge',
            'cloudflare'
          ],
          confidence: 0.98,
          endpointMatches: [
            'cloudflare-challenge-platform'
          ],
          summary: {
            url:
              'https://example.test/cdn-cgi/challenge-platform/',
            transport: 'fetch',
            method: 'GET',
            status: 403
          },
          evidence: [
            {
              signalId: 'abs-cloudflare-1',
              sequence: 30,
              kind: 'network-response',
              documentId: 'doc-1',
              reason:
                'retained anti-bot signal'
            }
          ]
        }
      ],

      analytics: [],
      infrastructure: [],
      unknown: []
    },

    implications: [
      {
        id: 'preserve-cookies',
        text:
          'Preserve observed cookie state across parser workflow steps.',
        confidence: 0.9,
        evidence: [
          {
            eventId: 'evt-cookie',
            sequence: 15,
            kind: 'network-response',
            documentId: 'doc-1',
            frameId: 0,
            reason:
              'observed cookie carrier name'
          }
        ]
      }
    ],

    gaps: [
      {
        id: 'form-value-equality',
        reason:
          'Raw form field values are intentionally not retained.'
      }
    ],

    ...overrides
  };
}

test(
  'renderer produces deterministic Markdown',
  () => {
    const input = blueprint();

    const first =
      renderParserBlueprintMarkdown(input);

    const second =
      renderParserBlueprintMarkdown(input);

    assert.equal(first, second);
  }
);

test(
  'renderer includes canonical Blueprint sections',
  () => {
    const markdown =
      renderParserBlueprintMarkdown(
        blueprint()
      );

    for (const heading of [
      '# Parser Blueprint',
      '## Transport Model',
      '## Workflow',
      '## Forms',
      '## State Carriers',
      '## Signals',
      '### Protection',
      '### Analytics',
      '### Infrastructure',
      '### Unknown',
      '## Parser Implications',
      '## Evidence Gaps'
    ]) {
      assert.ok(
        markdown.includes(heading),
        `missing heading: ${heading}`
      );
    }
  }
);

test(
  'renderer exposes evidence references',
  () => {
    const markdown =
      renderParserBlueprintMarkdown(
        blueprint()
      );

    assert.ok(
      markdown.includes('evt-form')
    );

    assert.ok(
      markdown.includes('evt-cookie')
    );

    assert.ok(
      markdown.includes(
        'abs-cloudflare-1'
      )
    );
  }
);

test(
  'empty sections render predictably',
  () => {
    const input = blueprint({
      workflow: {
        steps: []
      },

      forms: {
        status: 'not-observed',
        valueComparison:
          'presence-only',
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

    const markdown =
      renderParserBlueprintMarkdown(
        input
      );

    assert.ok(
      markdown.includes(
        '_No workflow evidence observed._'
      )
    );

    assert.ok(
      markdown.includes(
        '_No form models observed._'
      )
    );

    assert.ok(
      markdown.includes(
        '_No state carriers observed._'
      )
    );

    assert.ok(
      markdown.includes(
        '_No parser implications inferred._'
      )
    );

    assert.ok(
      markdown.includes(
        '_No unresolved evidence gaps._'
      )
    );
  }
);

test(
  'renderer does not serialize unknown secret-bearing properties',
  () => {
    const input = blueprint();

    input.stateCarriers[0].value =
      'SUPER_SECRET_VALUE';

    input.stateCarriers[0].raw =
      'sessionid=SUPER_SECRET_VALUE';

    input.signals.protection[0].secret =
      'DO_NOT_RENDER_ME';

    const markdown =
      renderParserBlueprintMarkdown(
        input
      );

    assert.equal(
      markdown.includes(
        'SUPER_SECRET_VALUE'
      ),
      false
    );

    assert.equal(
      markdown.includes(
        'DO_NOT_RENDER_ME'
      ),
      false
    );
  }
);

test(
  'renderer does not mutate the Blueprint',
  () => {
    const input = blueprint();

    const before =
      JSON.stringify(input);

    renderParserBlueprintMarkdown(
      input
    );

    assert.equal(
      JSON.stringify(input),
      before
    );
  }
);
