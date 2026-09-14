import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSessionUpdateBroadcaster
} from '../src/session-update-broadcaster.js';

function createFakeTimers() {
  const scheduled = [];
  let nextId = 1;

  return {
    scheduled,

    setTimer(callback, delay) {
      const entry = {
        id: nextId++,
        callback,
        delay,
        cancelled: false
      };

      scheduled.push(entry);
      return entry.id;
    },

    clearTimer(id) {
      const entry =
        scheduled.find(item => item.id === id);

      if (entry) {
        entry.cancelled = true;
      }
    }
  };
}

test(
  'coalesces a burst of session updates into one broadcast per tab',
  async () => {
    const timers = createFakeTimers();
    const sent = [];

    const broadcaster =
      createSessionUpdateBroadcaster({
        sendMessage: async message => {
          sent.push(message);
        },
        delay: 400,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer
      });

    for (let index = 0; index < 20; index += 1) {
      broadcaster.schedule(42);
    }

    assert.equal(timers.scheduled.length, 1);
    assert.equal(timers.scheduled[0].delay, 400);
    assert.equal(sent.length, 0);
    assert.equal(
      broadcaster.hasPending(42),
      true
    );

    await timers.scheduled[0].callback();

    assert.deepEqual(sent, [
      {
        type: 'BRT_SESSION_UPDATED',
        tabId: 42
      }
    ]);

    assert.equal(
      broadcaster.hasPending(42),
      false
    );
  }
);

test(
  'allows another broadcast after the previous window fires',
  async () => {
    const timers = createFakeTimers();
    const sent = [];

    const broadcaster =
      createSessionUpdateBroadcaster({
        sendMessage: async message => {
          sent.push(message);
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer
      });

    broadcaster.schedule(7);

    await timers.scheduled[0].callback();

    broadcaster.schedule(7);
    broadcaster.schedule(7);

    assert.equal(
      timers.scheduled.length,
      2
    );

    await timers.scheduled[1].callback();

    assert.equal(sent.length, 2);
    assert.deepEqual(
      sent.map(item => item.tabId),
      [7, 7]
    );
  }
);

test(
  'coalesces independently per tab and tolerates no UI listener',
  async () => {
    const timers = createFakeTimers();
    let calls = 0;

    const broadcaster =
      createSessionUpdateBroadcaster({
        sendMessage: async () => {
          calls += 1;
          throw new Error(
            'Receiving end does not exist.'
          );
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer
      });

    broadcaster.schedule(1);
    broadcaster.schedule(1);
    broadcaster.schedule(2);

    assert.equal(
      timers.scheduled.length,
      2
    );

    await Promise.all(
      timers.scheduled.map(
        entry => entry.callback()
      )
    );

    assert.equal(calls, 2);
    assert.equal(
      broadcaster.hasPending(1),
      false
    );
    assert.equal(
      broadcaster.hasPending(2),
      false
    );
  }
);
