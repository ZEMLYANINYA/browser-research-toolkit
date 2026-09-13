import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyNetwork,
  isAnalyticsNetworkRecord
} from '../src/network-analysis.js';

import {
  generateParserBlueprint
} from '../src/parser-blueprint.js';

import {
  renderParserBlueprintMarkdown
} from '../src/parser-blueprint-markdown.js';

function request({
  eventId,
  sequence,
  url,
  transport = 'xhr',
  classification = 'unknown',
  frameId = 0,
  documentId = 'doc-1'
}) {
  return {
    eventId,
    sequence,
    wallTime: sequence,
    kind: 'network-request',
    documentId,
    frameId,
    data: {
      method: 'GET',
      url,
      transport,
      classification
    }
  };
}

test(
  'Google logging endpoints classify as analytics without broad path false positives',
  () => {
    for (const data of [
      {
        url:
          'https://www.google.com.ua/maps/preview/log204?authuser=0',
        transport: 'xhr'
      },
      {
        url:
          'https://example.test/gen_204',
        transport: 'fetch'
      },
      {
        url:
          'https://play.google.com/log?format=json&hasfast=true',
        transport: 'xhr'
      },
      {
        url:
          'https://www.google.com.ua/log?format=json&hasfast=true',
        transport: 'fetch'
      },
      {
        url:
          'https://example.test/log',
        transport: 'beacon'
      },
      {
        url:
          'https://example.test/log',
        transport: 'xhr',
        status: 204,
        body: ''
      }
    ]) {
      assert.equal(
        isAnalyticsNetworkRecord(data),
        true,
        data.url
      );

      assert.equal(
        classifyNetwork(data).classification,
        'analytics',
        data.url
      );
    }

    for (const data of [
      {
        url:
          'https://streetviewpixels-pa.googleapis.com/v1/tile?cb_client=maps_sv.tactile',
        transport: 'xhr'
      },
      {
        url:
          'https://www.google.com.ua/maps/_/wa/m.XdyBdmG81vY.loadSv.O.wasm',
        transport: 'xhr'
      },
      {
        url:
          'https://www.google.com.ua/search?q=cafe',
        transport: 'fetch'
      },
      {
        url:
          'https://www.google.com.ua/maps/preview/place',
        transport: 'xhr'
      },
      {
        url:
          'https://www.google.com.ua/maps/_/MapsWizUi/data/batchexecute',
        transport: 'xhr'
      }
    ]) {
      assert.equal(
        isAnalyticsNetworkRecord(data),
        false,
        data.url
      );

      assert.notEqual(
        classifyNetwork(data).classification,
        'analytics',
        data.url
      );
    }
  }
);

test(
  'Parser Blueprint moves historical Google logging out of workflow while retaining analytics evidence',
  () => {
    const log204 = request({
      eventId: 'evt-log204',
      sequence: 10,
      url:
        'https://www.google.com.ua/maps/preview/log204?authuser=0',
      classification: 'unknown'
    });

    const tile = request({
      eventId: 'evt-tile',
      sequence: 20,
      url:
        'https://streetviewpixels-pa.googleapis.com/v1/tile?x=0&y=0&zoom=0',
      classification: 'analytics'
    });

    const googleLog = request({
      eventId: 'evt-log',
      sequence: 30,
      url:
        'https://play.google.com/log?format=json&hasfast=true',
      transport: 'beacon',
      classification: 'unknown'
    });

    const place = request({
      eventId: 'evt-place',
      sequence: 40,
      url:
        'https://www.google.com.ua/maps/preview/place',
      classification: 'unknown'
    });

    const blueprint =
      generateParserBlueprint({
        sessionId: 'session-maps',
        sequence: 40,
        pageUrl:
          'https://www.google.com.ua/maps/',
        timeline: [
          log204,
          tile,
          googleLog,
          place
        ],
        network: [
          tile,
          place
        ],
        diagnostics: [],
        antiBot: {
          signals: []
        }
      });

    assert.deepEqual(
      blueprint.workflow.steps.map(
        step => step.endpointFamily
      ),
      [
        '/v1/tile',
        '/maps/preview/place'
      ]
    );

    assert.deepEqual(
      blueprint.signals.analytics
        .map(signal => signal.target)
        .sort(),
      [
        'https://www.google.com.ua/maps/preview/log204?authuser=0',
        'https://play.google.com/log?format=json&hasfast=true'
      ].sort()
    );
  }
);

test(
  'Parser Blueprint projects producer sequence diagnostics into structured evidence gaps',
  () => {
    const blueprint =
      generateParserBlueprint({
        sessionId: 'session-gap',
        sequence: 4111,
        pageUrl:
          'https://www.google.com.ua/maps/',
        timeline: [],
        network: [],
        antiBot: {
          signals: []
        },
        diagnostics: [
          {
            at: 1789163292821,
            kind:
              'page-producer-sequence-gap',
            expectedProducerSequence: 3952,
            receivedProducerSequence: 4111,
            missingCount: 159,
            generation: 2,
            runId: 'run-maps',
            documentId: 'doc-maps',
            frameId: 0,
            provenance: 'page-observable'
          }
        ]
      });

    assert.deepEqual(
      blueprint.gaps,
      [
        {
          id:
            'page-producer-sequence-gap-1',
          kind:
            'page-producer-sequence-gap',
          at: 1789163292821,
          documentId: 'doc-maps',
          frameId: 0,
          expectedProducerSequence: 3952,
          receivedProducerSequence: 4111,
          missingProducerSequenceFrom: 3952,
          missingProducerSequenceTo: 4110,
          missingCount: 159,
          generation: 2,
          runId: 'run-maps',
          provenance: 'page-observable',
          reason:
            'Page producer sequence gap recorded; captured evidence is incomplete for this producer range.'
        }
      ]
    );

    const markdown =
      renderParserBlueprintMarkdown(
        blueprint
      );

    assert.match(
      markdown,
      /## Evidence Gaps/
    );

    assert.match(
      markdown,
      /3952\.\.4110/
    );

    assert.match(
      markdown,
      /Missing count: 159/
    );
  }
);

test(
  'Evidence gap Markdown caps verbose producer diagnostics',
  () => {
    const gaps =
      Array.from(
        { length: 12 },
        (_, index) => ({
          id:
            'page-producer-sequence-gap-' +
            String(index + 1),
          kind:
            'page-producer-sequence-gap',
          expectedProducerSequence:
            index * 10,
          receivedProducerSequence:
            index * 10 + 2,
          missingProducerSequenceFrom:
            index * 10,
          missingProducerSequenceTo:
            index * 10 + 1,
          missingCount: 2,
          reason: 'gap'
        })
      );

    const markdown =
      renderParserBlueprintMarkdown({
        schemaVersion: 1,
        source: {},
        transport: {},
        workflow: {
          steps: []
        },
        forms: {
          observations: [],
          models: []
        },
        stateCarriers: [],
        signals: {},
        implications: [],
        gaps
      });

    assert.match(
      markdown,
      /Total gaps: 12/
    );

    assert.match(
      markdown,
      /Showing first 10 of 12 gaps/
    );
  }
);
