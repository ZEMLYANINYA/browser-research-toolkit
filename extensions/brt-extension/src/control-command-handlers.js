import { TaskError } from './task-runner.js';
export function createControlCommandHandlers({
  activeTab,
  loadSession,
  sendCommand,
  sessionGeneration,
  pushCapped,
  pushTimeline,
  scheduleFlush,
  taskRunner
}) {
  if (typeof activeTab !== 'function') throw new TypeError('activeTab is required.');
  if (typeof loadSession !== 'function') throw new TypeError('loadSession is required.');
  if (typeof sendCommand !== 'function') throw new TypeError('sendCommand is required.');
  if (typeof sessionGeneration !== 'function') throw new TypeError('sessionGeneration is required.');
  if (typeof pushCapped !== 'function') throw new TypeError('pushCapped is required.');
  if (typeof pushTimeline !== 'function') throw new TypeError('pushTimeline is required.');
  if (typeof scheduleFlush !== 'function') throw new TypeError('scheduleFlush is required.');
  if (!taskRunner || typeof taskRunner.cancel !== 'function') throw new TypeError('taskRunner.cancel is required.');

  return Object.freeze({
    BRT_REFRESH_SOURCES: async () => {
      const tab = await activeTab();

      if (tab?.id) {
        await sendCommand(
          tab.id,
          'REFRESH_SOURCES',
          sessionGeneration(tab.id)
        );
      }

      return { ok: true };
    },

    BRT_WATCH_ADD: async message => {
      const tab = await activeTab();
      const path = message.path || '';

      if (
        tab?.id &&
        /^window(?:\.[A-Za-z_$][\w$]*)+$/.test(path)
      ) {
        await sendCommand(
          tab.id,
          'WATCH_ADD',
          sessionGeneration(tab.id),
          { path }
        );
      }

      return { ok: true };
    },

    BRT_MARK: async message => {
      const tab = await activeTab();
      const session = tab?.id
        ? await loadSession(tab.id)
        : null;

      if (!session?.running || session.importedReadOnly) {
        throw new Error('Markers require an active live session.');
      }

      const marker = {
        markerId: `mark_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        text: String(message.text || 'marker').slice(0, 200),
        category: String(message.category || 'experiment').slice(0, 50),
        eventId: `evt_${Date.now().toString(36)}_${++session.sequence}`,
        sequence: session.sequence,
        sessionId: session.sessionId,
        documentId: session.documents.at(-1)?.documentId || 'unknown',
        wallTime: Date.now(),
        provenance: {
          collector: 'side-panel',
          transport: 'chrome.runtime',
          integrity: 'extension-controlled'
        }
      };

      session.markers = Array.isArray(session.markers)
        ? session.markers
        : [];

      pushCapped(session.markers, marker, 300);
      pushTimeline(session, {
        ...marker,
        kind: 'marker',
        label: `MARK: ${marker.text}`,
        data: marker
      });

      scheduleFlush(tab.id);

      return { ok: true, marker };
    },

    BRT_CANCEL_TASK: async message => {
      if (
        typeof message.taskId !== 'string' ||
        message.taskId.length > 120
      ) {
        throw new TaskError(
          'INVALID_TASK_ID',
          'Invalid task id.'
        );
      }

      return {
        ok: taskRunner.cancel(
          message.taskId,
          'Cancelled by user.'
        )
      };
    },
    BRT_LABEL_CORRELATION: async message => {
      const tab = await activeTab();
      const session = tab?.id
        ? await loadSession(tab.id)
        : null;

      const item = session?.correlations?.find(
        relationship =>
          relationship.relationshipId === message.relationshipId
      );

      if (!item) {
        throw new Error('Correlation record not found.');
      }

      item.manualStatus =
        message.status === 'not-related'
          ? 'not-related'
          : 'related';

      item.manualLabelAt = Date.now();

      if (session) scheduleFlush(tab.id);

      return { ok: true };
    }
  });
}
