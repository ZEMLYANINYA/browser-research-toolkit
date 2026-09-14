import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSessionSummary
} from '../src/session-summary.js';

function makeRows(count, kind) {
  return Array.from(
    { length: count },
    (_, index) => ({
      sequence: index + 1,
      kind,
      wallTime: 1000 + index,
      data: {
        value: `row-${index + 1}`
      }
    })
  );
}

function fixture() {
  return {
    sessionId: 'session-heavy',
    tabId: 7,
    runId: 'run-heavy',
    running: true,
    runState: 'running',
    generation: 3,
    sequence: 5000,
    startedAt: 1000,
    updatedAt: 9000,
    pageUrl: 'https://example.test/',
    counters: {
      requests: 1200,
      responses: 1100,
      domEvents: 2200
    },
    retention: {
      timelineSeen: 3000,
      timelineEvicted: 500,
      timelineDropped: 0,
      networkSeen: 1400,
      networkEvicted: 400
    },
    storageStats: {
      approxBytes: 8_000_000
    },
    timeline: makeRows(
      120,
      'dom-event'
    ),
    network: makeRows(
      90,
      'network-request'
    ),
    sources: Array.from(
      { length: 70 },
      (_, index) => ({
        id: `source-${index}`,
        url: `https://example.test/${index}.js`,
        indexed: true,
        text: 'x'.repeat(5000)
      })
    ),
    correlations: Array.from(
      { length: 75 },
      (_, index) => ({
        relationshipId: `rel-${index}`
      })
    ),
    inferences: Array.from(
      { length: 65 },
      (_, index) => ({
        kind: `inference-${index}`
      })
    ),
    diagnostics: Array.from(
      { length: 60 },
      (_, index) => ({
        kind: `diag-${index}`
      })
    ),
    runtime: Array.from(
      { length: 40 },
      (_, index) => ({
        path: `window.value${index}`,
        value: 'secret-ish-runtime-value'
      })
    ),
    html: '<html>' + 'A'.repeat(100_000) + '</html>',
    antiBot: {
      enabled: true,
      stats: {
        totalSeen: 150
      },
      lifecycle: {
        documentsObserved: 8
      },
      signals: Array.from(
        { length: 100 },
        (_, index) => ({
          kind: `signal-${index}`,
          firstSequence: index + 1
        })
      )
    },
    documents: [
      {
        documentId: 'doc-1'
      }
    ],
    errors: [],
    tasks: [
      {
        taskId: 'task-1',
        status: 'completed'
      }
    ]
  };
}

test(
  'session summary bounds heavy retained collections and strips bulk text',
  () => {
    const session = fixture();

    const summary =
      createSessionSummary(session);

    assert.equal(
      summary.summaryMode,
      true
    );

    assert.equal(
      summary.timeline.length,
      50
    );

    assert.equal(
      summary.network.length,
      50
    );

    assert.deepEqual(
      summary.sources,
      []
    );

    assert.deepEqual(
      summary.correlations,
      []
    );

    assert.deepEqual(
      summary.inferences,
      []
    );

    assert.deepEqual(
      summary.diagnostics,
      []
    );

    assert.deepEqual(
      summary.runtime,
      []
    );

    assert.equal(
      summary.html,
      ''
    );

    assert.deepEqual(
      summary.antiBot.signals,
      []
    );
  }
);

test(
  'session summary reports full collection counts while keeping the latest tail',
  () => {
    const session = fixture();

    const summary =
      createSessionSummary(
        session,
        {
          tailLimit: 10,
          antiBotSignalLimit: 12
        }
      );

    assert.deepEqual(
      summary.summaryCounts,
      {
        timeline: 120,
        network: 90,
        sources: 70,
        sourcesIndexed: 70,
        sourcesMetadataOnly: 0,
        correlations: 75,
        inferences: 65,
        diagnostics: 60,
        runtime: 40,
        htmlChars: session.html.length,
        antiBotSignals: 100,
        errors: 0
      }
    );

    assert.deepEqual(
      summary.timeline.map(
        item => item.sequence
      ),
      session.timeline
        .slice(-10)
        .map(item => item.sequence)
    );

    assert.deepEqual(
      summary.antiBot.signals,
      []
    );
  }
);

test(
  'session summary does not mutate the full session and is materially smaller',
  () => {
    const session = fixture();

    const before =
      JSON.stringify(session);

    const summary =
      createSessionSummary(session);

    const after =
      JSON.stringify(session);

    assert.equal(
      after,
      before,
      'summary creation must not mutate the full session'
    );

    const fullBytes =
      Buffer.byteLength(before);

    const summaryBytes =
      Buffer.byteLength(
        JSON.stringify(summary)
      );

    assert.ok(
      summaryBytes < fullBytes / 2,
      `expected summary to be materially smaller: ${summaryBytes} vs ${fullBytes}`
    );

    assert.equal(
      session.sources[0].text.length,
      5000
    );

    assert.equal(
      session.runtime.length,
      40
    );

    assert.ok(
      session.html.length > 100_000
    );
  }
);
test(
  'session summary excludes unknown future session fields by default',
  () => {
    const session = fixture();

    session.futureHeavyCollection =
      Array.from(
        { length: 500 },
        (_, index) => ({
          index,
          payload: 'x'.repeat(2000)
        })
      );

    session.futureHeavyText =
      'Y'.repeat(250_000);

    const summary =
      createSessionSummary(session);

    assert.equal(
      Object.hasOwn(
        summary,
        'futureHeavyCollection'
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        summary,
        'futureHeavyText'
      ),
      false
    );

    assert.equal(
      session.futureHeavyCollection.length,
      500
    );

    assert.equal(
      session.futureHeavyText.length,
      250_000
    );
  }
);
