import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlCommandHandlers } from '../src/control-command-handlers.js';

function fixture({ tab = { id: 7 } } = {}) {
  const session = {
    running: true,
    importedReadOnly: false,
    sequence: 4,
    sessionId: 'session-1',
    documents: [{ documentId: 'doc-1' }],
    markers: [],
    correlations: [{ relationshipId: 'rel-1' }]
  };

  const calls = {
    commands: [],
    flushes: [],
    capped: [],
    timeline: [],
    cancellations: []
  };

  const handlers = createControlCommandHandlers({
    activeTab: async () => tab,
    loadSession: async () => session,
    sendCommand: async (...args) => {
      calls.commands.push(args);
    },
    sessionGeneration: tabId => {
      assert.equal(tabId, 7);
      return 12;
    },
    pushCapped: (target, value, limit) => {
      calls.capped.push({ target, value, limit });
      target.push(value);
    },
    pushTimeline: (value, event) => {
      calls.timeline.push({ session: value, event });
    },
    scheduleFlush: tabId => {
      calls.flushes.push(tabId);
    },
    taskRunner: {
      cancel(taskId, reason) {
        calls.cancellations.push({ taskId, reason });
        return true;
      }
    }
  });

  return { handlers, session, calls };
}

test('REFRESH_SOURCES forwards the current generation', async () => {
  const { handlers, calls } = fixture();

  assert.deepEqual(
    await handlers.BRT_REFRESH_SOURCES({}),
    { ok: true }
  );

  assert.deepEqual(
    calls.commands,
    [[7, 'REFRESH_SOURCES', 12]]
  );
});

test('WATCH_ADD forwards only valid window paths', async () => {
  const { handlers, calls } = fixture();

  await handlers.BRT_WATCH_ADD({ path: 'window.app.state' });

  assert.deepEqual(
    calls.commands,
    [[7, 'WATCH_ADD', 12, { path: 'window.app.state' }]]
  );

  calls.commands.length = 0;

  await handlers.BRT_WATCH_ADD({ path: 'document.cookie' });

  assert.deepEqual(calls.commands, []);
});

test('MARK records bounded side-panel evidence and schedules persistence', async () => {
  const { handlers, session, calls } = fixture();

  const response = await handlers.BRT_MARK({
    text: 'checkpoint',
    category: 'experiment'
  });

  assert.equal(response.ok, true);
  assert.equal(response.marker.text, 'checkpoint');
  assert.equal(response.marker.category, 'experiment');
  assert.equal(response.marker.sequence, 5);
  assert.equal(response.marker.sessionId, 'session-1');
  assert.equal(response.marker.documentId, 'doc-1');
  assert.deepEqual(response.marker.provenance, {
    collector: 'side-panel',
    transport: 'chrome.runtime',
    integrity: 'extension-controlled'
  });
  assert.equal(session.markers.length, 1);
  assert.equal(calls.capped[0].limit, 300);
  assert.equal(calls.timeline[0].event.kind, 'marker');
  assert.equal(calls.timeline[0].event.label, 'MARK: checkpoint');
  assert.deepEqual(calls.flushes, [7]);
});

test('MARK rejects stopped and imported sessions', async () => {
  const first = fixture();
  first.session.running = false;

  await assert.rejects(
    first.handlers.BRT_MARK({}),
    /Markers require an active live session/
  );

  const second = fixture();
  second.session.importedReadOnly = true;

  await assert.rejects(
    second.handlers.BRT_MARK({}),
    /Markers require an active live session/
  );
});

test('CANCEL_TASK delegates user cancellation to the task runner', async () => {
  const { handlers, calls } = fixture();

  assert.deepEqual(
    await handlers.BRT_CANCEL_TASK({ taskId: 'task-1' }),
    { ok: true }
  );

  assert.deepEqual(calls.cancellations, [
    {
      taskId: 'task-1',
      reason: 'Cancelled by user.'
    }
  ]);
});

test('CANCEL_TASK rejects invalid task ids', async () => {
  const { handlers, calls } = fixture();

  await assert.rejects(
    handlers.BRT_CANCEL_TASK({ taskId: null }),
    error =>
      error?.code === 'INVALID_TASK_ID' &&
      /Invalid task id/.test(error.message)
  );

  await assert.rejects(
    handlers.BRT_CANCEL_TASK({ taskId: 'x'.repeat(121) }),
    error =>
      error?.code === 'INVALID_TASK_ID' &&
      /Invalid task id/.test(error.message)
  );

  assert.deepEqual(calls.cancellations, []);
});
test('LABEL_CORRELATION mutates only the selected relationship and schedules persistence', async () => {
  const { handlers, session, calls } = fixture();

  assert.deepEqual(
    await handlers.BRT_LABEL_CORRELATION({
      relationshipId: 'rel-1',
      status: 'not-related'
    }),
    { ok: true }
  );

  assert.equal(session.correlations[0].manualStatus, 'not-related');
  assert.equal(typeof session.correlations[0].manualLabelAt, 'number');
  assert.deepEqual(calls.flushes, [7]);
});

test('LABEL_CORRELATION rejects a missing relationship', async () => {
  const { handlers } = fixture();

  await assert.rejects(
    handlers.BRT_LABEL_CORRELATION({
      relationshipId: 'missing',
      status: 'related'
    }),
    /Correlation record not found/
  );
});

test('factory rejects missing orchestration dependencies', () => {
  assert.throws(
    () => createControlCommandHandlers({}),
    /activeTab is required/
  );
});
