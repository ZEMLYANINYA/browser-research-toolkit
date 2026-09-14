import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlQueryHandlers } from '../src/control-query-handlers.js';

function fixture({ tab = { id: 7, title: 'Example', url: 'https://example.test/' } } = {}) {
  const session = {
    sessionId: 'session-1',
    diagnostics: [{ kind: 'diag' }],
    correlations: [{ relationshipId: 'rel-1' }],
    inferences: [{ kind: 'inference' }],
    antiBot: { enabled: true, signals: [] },
    network: [],
    timeline: [],
    sources: [],
    runtime: [],
    html: ''
  };

  const calls = {
    loadSession: [],
    taskList: [],
    antiBotAnalysis: []
  };

  const handlers = createControlQueryHandlers({
    activeTab: async () => tab,
    loadSession: async tabId => {
      calls.loadSession.push(tabId);
      return session;
    },
    taskRunner: {
      list(filter) {
        calls.taskList.push(filter);
        return [{ taskId: 'task-1' }];
      }
    },
    getAntiBotAnalysis(tabId, value) {
      calls.antiBotAnalysis.push({ tabId, session: value });
      return { provider: 'fixture' };
    }
  });

  return { handlers, session, calls };
}

test('GET_ACTIVE_TAB returns a bounded tab descriptor', async () => {
  const { handlers } = fixture();

  assert.deepEqual(
    await handlers.BRT_GET_ACTIVE_TAB({}),
    {
      tab: {
        id: 7,
        title: 'Example',
        url: 'https://example.test/'
      }
    }
  );
});

test('GET_ACTIVE_TAB and GET_SESSION preserve no-active-tab behavior', async () => {
  const { handlers, calls } = fixture({ tab: null });

  assert.deepEqual(await handlers.BRT_GET_ACTIVE_TAB({}), { tab: null });
  assert.deepEqual(await handlers.BRT_GET_SESSION({}), { session: null });
  assert.deepEqual(calls.loadSession, []);
});

test('GET_SESSION loads the active tab session', async () => {
  const { handlers, session, calls } = fixture();

  assert.deepEqual(
    await handlers.BRT_GET_SESSION({}),
    { session }
  );
  assert.deepEqual(calls.loadSession, [7]);
});

test('GET_SESSION summary mode returns a bounded lightweight session', async () => {
  const { handlers, session, calls } = fixture();

  session.timeline =
    Array.from(
      { length: 80 },
      (_, index) => ({
        sequence: index + 1,
        kind: 'dom-event'
      })
    );

  session.network =
    Array.from(
      { length: 70 },
      (_, index) => ({
        sequence: index + 1,
        kind: 'network-request'
      })
    );

  session.sources =
    Array.from(
      { length: 60 },
      (_, index) => ({
        id: `source-${index}`,
        text: 'x'.repeat(1000)
      })
    );

  session.runtime = [
    {
      path: 'window.secret',
      value: 'should-not-cross-summary-boundary'
    }
  ];

  session.html =
    '<html>' +
    'A'.repeat(10_000) +
    '</html>';

  session.antiBot = {
    enabled: true,
    signals:
      Array.from(
        { length: 100 },
        (_, index) => ({
          kind: `signal-${index}`
        })
      )
  };

  const response =
    await handlers.BRT_GET_SESSION({
      summary: true
    });

  const summary =
    response.session;

  assert.equal(
    summary.summaryMode,
    true
  );

  assert.equal(
    summary.summaryCounts.timeline,
    80
  );

  assert.equal(
    summary.summaryCounts.network,
    70
  );

  assert.equal(
    summary.summaryCounts.sources,
    60
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
    summary.antiBot.signals,
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
    calls.loadSession,
    [7]
  );
});

test('GET_TASKS scopes task listing to the active tab', async () => {
  const { handlers, calls } = fixture();

  assert.deepEqual(
    await handlers.BRT_GET_TASKS({}),
    { tasks: [{ taskId: 'task-1' }] }
  );
  assert.deepEqual(calls.taskList, [{ tabId: 7 }]);
});

test('SEARCH delegates to session search semantics', async () => {
  const { handlers, session } = fixture();
  session.html = 'alpha beta gamma';

  const response = await handlers.BRT_SEARCH({
    query: 'beta',
    scopes: { html: true, timeline: false }
  });

  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].scope, 'HTML');
  assert.match(response.results[0].snippet, /beta/);
});

test('GET_PARSER_BLUEPRINT returns blueprint and markdown', async () => {
  const { handlers } = fixture();

  const response = await handlers.BRT_GET_PARSER_BLUEPRINT({});

  assert.ok(response.blueprint);
  assert.equal(typeof response.markdown, 'string');
  assert.ok(response.markdown.length > 0);
});

test('GET_DIAGNOSTICS aggregates session analysis and tab-scoped tasks', async () => {
  const { handlers, session, calls } = fixture();

  const response = await handlers.BRT_GET_DIAGNOSTICS({});

  assert.deepEqual(response.diagnostics, session.diagnostics);
  assert.deepEqual(response.correlations, session.correlations);
  assert.deepEqual(response.inferences, session.inferences);
  assert.deepEqual(response.antiBot, session.antiBot);
  assert.deepEqual(response.antiBotAnalysis, { provider: 'fixture' });
  assert.deepEqual(response.tasks, [{ taskId: 'task-1' }]);
  assert.deepEqual(calls.taskList, [{ tabId: 7 }]);
  assert.equal(calls.antiBotAnalysis.length, 1);
  assert.equal(calls.antiBotAnalysis[0].tabId, 7);
  assert.equal(calls.antiBotAnalysis[0].session, session);
});

test('factory rejects missing orchestration dependencies', () => {
  assert.throws(
    () => createControlQueryHandlers({}),
    /activeTab is required/
  );
});
