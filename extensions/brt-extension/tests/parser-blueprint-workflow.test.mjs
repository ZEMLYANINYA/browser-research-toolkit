import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateParserBlueprint
} from '../src/parser-blueprint.js';

function baseSession(overrides = {}) {
  return {
    sessionId: 'session-workflow-1',
    sequence: 100,
    pageUrl: 'https://example.test/search',
    network: [],
    timeline: [],
    documents: [],
    sources: [],
    correlations: [],
    ...overrides
  };
}

function field(
  fieldIndex,
  name,
  type = 'text',
  hasValue = true,
  overrides = {}
) {
  return {
    fieldIndex,
    name,
    type,
    hidden: type === 'hidden',
    disabled: false,
    required: false,
    multiple: false,
    checked: false,
    hasValue,
    ...overrides
  };
}

function formEvent({
  eventId,
  sequence,
  documentId = 'doc-top',
  frameId = 0,
  action = 'https://example.test/search',
  method = 'POST',
  trigger = 'native',
  fields = []
}) {
  return {
    eventId,
    sequence,
    kind: 'form-submit',
    sessionId: 'session-workflow-1',
    documentId,
    frameId,
    wallTime: sequence * 100,
    data: {
      trigger,
      method,
      action,
      enctype: 'application/x-www-form-urlencoded',
      form: {
        selectorHint: 'form#search',
        role: null,
        type: null,
        name: 'search'
      },
      submitter: null,
      fieldCount: fields.length,
      fieldsTruncated: false,
      fields
    }
  };
}

function networkRequest({
  eventId,
  sequence,
  documentId = 'doc-top',
  frameId = 0,
  transport = 'fetch',
  method = 'GET',
  url
}) {
  return {
    eventId,
    sequence,
    kind: 'network-request',
    sessionId: 'session-workflow-1',
    documentId,
    frameId,
    wallTime: sequence * 100,
    data: {
      transport,
      method,
      url
    }
  };
}

function hardNavigation({
  eventId,
  sequence,
  documentId = 'doc-next',
  frameId = 0,
  url
}) {
  return {
    eventId,
    sequence,
    kind: 'hard-navigation',
    sessionId: 'session-workflow-1',
    documentId,
    frameId,
    wallTime: sequence * 100,
    data: {
      url,
      isTopFrame: frameId === 0,
      transitionType: 'form_submit'
    }
  };
}

test('workflow merges evidence into deterministic sequence order', () => {
  const session = baseSession({
    timeline: [
      hardNavigation({
        eventId: 'evt-nav',
        sequence: 30,
        url: 'https://example.test/results'
      }),
      formEvent({
        eventId: 'evt-form',
        sequence: 10,
        fields: [
          field(0, 'query')
        ]
      })
    ],
    network: [
      networkRequest({
        eventId: 'evt-request',
        sequence: 20,
        transport: 'fetch',
        url: 'https://example.test/api/search'
      })
    ]
  });

  const blueprint = generateParserBlueprint(session);

  assert.deepEqual(
    blueprint.workflow.steps.map(step => step.kind),
    [
      'form-submit',
      'network-request',
      'hard-navigation'
    ]
  );

  assert.deepEqual(
    blueprint.workflow.steps.map(step => step.stepIndex),
    [0, 1, 2]
  );

  assert.deepEqual(
    blueprint.workflow.steps.map(
      step => step.evidence.eventId
    ),
    [
      'evt-form',
      'evt-request',
      'evt-nav'
    ]
  );
});

test('repeated form observations produce a stable form model', () => {
  const session = baseSession({
    timeline: [
      formEvent({
        eventId: 'evt-form-1',
        sequence: 10,
        documentId: 'doc-1',
        fields: [
          field(0, 'query'),
          field(1, 'page', 'hidden')
        ]
      }),
      formEvent({
        eventId: 'evt-form-2',
        sequence: 40,
        documentId: 'doc-2',
        fields: [
          field(0, 'query'),
          field(1, 'page', 'hidden')
        ]
      })
    ]
  });

  const blueprint = generateParserBlueprint(session);

  assert.equal(blueprint.forms.status, 'observed');
  assert.equal(blueprint.forms.observations.length, 2);
  assert.equal(blueprint.forms.models.length, 1);

  const model = blueprint.forms.models[0];

  assert.equal(model.observationCount, 2);
  assert.equal(model.fields.length, 2);

  const query = model.fields.find(
    item => item.fieldIndex === 0
  );

  assert.equal(query.nameStability, 'stable');
  assert.equal(query.stableName, 'query');
  assert.deepEqual(query.observedNames, ['query']);
});

test('changing field names are not exposed as stable constants', () => {
  const session = baseSession({
    timeline: [
      formEvent({
        eventId: 'evt-form-dynamic-1',
        sequence: 10,
        documentId: 'doc-1',
        fields: [
          field(
            0,
            '__VIEWSTATE_a1',
            'hidden'
          )
        ]
      }),
      formEvent({
        eventId: 'evt-form-dynamic-2',
        sequence: 20,
        documentId: 'doc-2',
        fields: [
          field(
            0,
            '__VIEWSTATE_b9',
            'hidden'
          )
        ]
      })
    ]
  });

  const blueprint = generateParserBlueprint(session);

  const dynamicField =
    blueprint.forms.models[0].fields[0];

  assert.equal(
    dynamicField.nameStability,
    'changing'
  );

  assert.equal(
    dynamicField.stableName,
    null
  );

  assert.deepEqual(
    dynamicField.observedNames,
    [
      '__VIEWSTATE_a1',
      '__VIEWSTATE_b9'
    ]
  );
});

test('value comparison remains presence-only and evidence-honest', () => {
  const session = baseSession({
    timeline: [
      formEvent({
        eventId: 'evt-presence-1',
        sequence: 10,
        fields: [
          field(0, 'state', 'hidden', true)
        ]
      }),
      formEvent({
        eventId: 'evt-presence-2',
        sequence: 20,
        fields: [
          field(0, 'state', 'hidden', false)
        ]
      })
    ]
  });

  const blueprint = generateParserBlueprint(session);

  assert.equal(
    blueprint.forms.valueComparison,
    'presence-only'
  );

  const stateField =
    blueprint.forms.models[0].fields[0];

  assert.deepEqual(
    stateField.valuePresence,
    {
      present: 1,
      empty: 1,
      stability: 'changing'
    }
  );

  assert.ok(
    blueprint.gaps.some(
      gap => gap.id === 'form-value-equality'
    )
  );
});

test('form observations preserve document and frame provenance', () => {
  const session = baseSession({
    timeline: [
      formEvent({
        eventId: 'evt-child-form',
        sequence: 10,
        documentId: 'doc-child',
        frameId: 7,
        action: 'https://child.example.test/search',
        fields: [
          field(0, 'query')
        ]
      })
    ]
  });

  const blueprint = generateParserBlueprint(session);

  assert.equal(
    blueprint.forms.observations[0].eventId,
    'evt-child-form'
  );

  assert.equal(
    blueprint.forms.observations[0].documentId,
    'doc-child'
  );

  assert.equal(
    blueprint.forms.observations[0].frameId,
    7
  );
});
