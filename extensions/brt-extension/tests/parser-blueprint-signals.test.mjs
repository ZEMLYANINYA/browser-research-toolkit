import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateParserBlueprint
} from '../src/parser-blueprint.js';

function baseSession(overrides = {}) {
  return {
    sessionId: 'session-signals-1',
    sequence: 100,
    pageUrl: 'https://example.test/search',
    network: [],
    timeline: [],
    documents: [],
    sources: [],
    correlations: [],
    antiBot: {
      enabled: true,
      signals: [],
      stats: {}
    },
    ...overrides
  };
}

function networkEvent({
  eventId,
  sequence,
  kind = 'network-request',
  data = {}
}) {
  return {
    eventId,
    sequence,
    kind,
    sessionId: 'session-signals-1',
    documentId: 'doc-top',
    frameId: 0,
    wallTime: sequence * 100,
    data
  };
}

function formEvent({
  eventId,
  sequence,
  documentId,
  fields
}) {
  return {
    eventId,
    sequence,
    kind: 'form-submit',
    sessionId: 'session-signals-1',
    documentId,
    frameId: 0,
    wallTime: sequence * 100,
    data: {
      trigger: 'native',
      method: 'POST',
      action: 'https://example.test/search',
      enctype:
        'application/x-www-form-urlencoded',
      form: {
        selectorHint: 'form#search',
        name: 'search'
      },
      submitter: null,
      fieldCount: fields.length,
      fieldsTruncated: false,
      fields
    }
  };
}

function hiddenField(
  fieldIndex,
  name,
  hasValue = true
) {
  return {
    fieldIndex,
    name,
    type: 'hidden',
    hidden: true,
    disabled: false,
    required: false,
    multiple: false,
    checked: false,
    hasValue
  };
}

test(
  'analytics evidence is separated from protection evidence',
  () => {
    const session = baseSession({
      network: [
        networkEvent({
          eventId: 'evt-analytics',
          sequence: 10,
          data: {
            transport: 'beacon',
            method: 'POST',
            url:
              'https://www.google-analytics.com/g/collect',
            classification: 'analytics',
            firstParty: false
          }
        })
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.signals.analytics.length,
      1
    );

    assert.equal(
      blueprint.signals.protection.length,
      0
    );

    const signal =
      blueprint.signals.analytics[0];

    assert.equal(
      signal.evidence[0].eventId,
      'evt-analytics'
    );

    assert.ok(
      Number.isFinite(signal.confidence)
    );
  }
);

test(
  'retained anti-bot signals become protection evidence',
  () => {
    const session = baseSession({
      antiBot: {
        enabled: true,
        signals: [
          {
            signalId: 'abs-cloudflare-1',
            documentId: 'doc-top',
            kind: 'network-request',
            firstSequence: 20,
            lastSequence: 20,
            categories: [
              'challenge',
              'cloudflare'
            ],
            confidence: 0.98,
            evidence: [
              'endpoint:cloudflare-challenge-platform'
            ],
            summary: {
              url:
                'https://example.test/cdn-cgi/challenge-platform/',
              transport: 'fetch',
              method: 'GET'
            }
          }
        ],
        stats: {}
      }
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.signals.protection.length,
      1
    );

    const protection =
      blueprint.signals.protection[0];

    assert.equal(
      protection.provider,
      'Cloudflare'
    );

    assert.equal(
      protection.confidence,
      0.98
    );

    assert.equal(
      protection.evidence[0].signalId,
      'abs-cloudflare-1'
    );
  }
);

test(
  'weak BIGipServer cookie evidence is infrastructure not protection',
  () => {
    const session = baseSession({
      network: [
        networkEvent({
          eventId: 'evt-f5-routing',
          sequence: 30,
          kind: 'network-response',
          data: {
            url:
              'https://example.test/search',
            status: 200,
            cookies:
              'BIGipServerpool_main=node-42'
          }
        })
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.signals.protection.length,
      0
    );

    assert.equal(
      blueprint.signals.infrastructure.length,
      1
    );

    assert.equal(
      blueprint.signals.infrastructure[0]
        .provider,
      'F5 BIG-IP / Advanced WAF'
    );

    assert.equal(
      blueprint.signals.infrastructure[0]
        .evidence[0].eventId,
      'evt-f5-routing'
    );
  }
);

test(
  'state carriers contain metadata without raw values',
  () => {
    const session = baseSession({
      timeline: [
        {
          eventId: 'evt-storage',
          sequence: 10,
          kind: 'storage-snapshot',
          sessionId: 'session-signals-1',
          documentId: 'doc-top',
          frameId: 0,
          wallTime: 1000,
          data: {
            storage: 'localStorage',
            keys: [
              {
                key: 'searchPreferences',
                length: 84
              }
            ]
          }
        },

        formEvent({
          eventId: 'evt-form-state',
          sequence: 20,
          documentId: 'doc-top',
          fields: [
            hiddenField(
              0,
              '__VIEWSTATE_a1'
            )
          ]
        })
      ],

      network: [
        networkEvent({
          eventId: 'evt-cookie',
          sequence: 15,
          kind: 'network-response',
          data: {
            url: 'https://example.test/',
            status: 200,
            cookies:
              'sessionid=SUPER_SECRET_VALUE; BIGipServerpool=node-a'
          }
        })
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    const types = new Set(
      blueprint.stateCarriers.map(
        carrier => carrier.type
      )
    );

    assert.ok(types.has('storage-key'));
    assert.ok(types.has('hidden-form-field'));
    assert.ok(types.has('cookie'));

    const serialized =
      JSON.stringify(
        blueprint.stateCarriers
      );

    assert.equal(
      serialized.includes(
        'SUPER_SECRET_VALUE'
      ),
      false
    );

    assert.equal(
      serialized.includes('node-a'),
      false
    );
  }
);

test(
  'parser implications are evidence-backed and confidence-scored',
  () => {
    const session = baseSession({
      timeline: [
        formEvent({
          eventId: 'evt-form-1',
          sequence: 10,
          documentId: 'doc-1',
          fields: [
            hiddenField(
              0,
              '__VIEWSTATE_a1'
            )
          ]
        }),

        formEvent({
          eventId: 'evt-form-2',
          sequence: 30,
          documentId: 'doc-2',
          fields: [
            hiddenField(
              0,
              '__VIEWSTATE_b9'
            )
          ]
        })
      ],

      network: [
        networkEvent({
          eventId: 'evt-session-cookie',
          sequence: 20,
          kind: 'network-response',
          data: {
            url:
              'https://example.test/search',
            status: 200,
            cookies:
              'sessionid=SECRET'
          }
        })
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    const ids = new Set(
      blueprint.implications.map(
        implication => implication.id
      )
    );

    assert.ok(
      ids.has('preserve-cookies')
    );

    assert.ok(
      ids.has(
        'refresh-hidden-form-state'
      )
    );

    assert.ok(
      ids.has(
        'do-not-hard-code-generated-field-names'
      )
    );

    assert.ok(
      ids.has(
        'reproduce-classic-form-submission'
      )
    );

    for (
      const implication
      of blueprint.implications
    ) {
      assert.ok(
        Number.isFinite(
          implication.confidence
        )
      );

      assert.ok(
        implication.confidence >= 0 &&
        implication.confidence <= 1
      );

      assert.ok(
        Array.isArray(
          implication.evidence
        )
      );

      assert.ok(
        implication.evidence.length > 0
      );
    }
  }
);

test(
  'weak ambiguous signal evidence is retained as unknown',
  () => {
    const session = baseSession({
      network: [
        networkEvent({
          eventId: 'evt-weak-verification',
          sequence: 50,
          data: {
            transport: 'fetch',
            method: 'GET',
            url:
              'https://example.test/verify-token',
            classification: 'unknown',
            firstParty: true
          }
        })
      ]
    });

    const blueprint =
      generateParserBlueprint(session);

    assert.equal(
      blueprint.signals.protection.length,
      0
    );

    assert.equal(
      blueprint.signals.analytics.length,
      0
    );

    assert.equal(
      blueprint.signals.infrastructure.length,
      0
    );

    assert.equal(
      blueprint.signals.unknown.length,
      1
    );

    const signal =
      blueprint.signals.unknown[0];

    assert.ok(
      signal.categories.includes(
        'verification'
      )
    );

    assert.ok(
      Number.isFinite(signal.confidence)
    );

    assert.equal(
      signal.evidence[0].eventId,
      'evt-weak-verification'
    );
  }
);
