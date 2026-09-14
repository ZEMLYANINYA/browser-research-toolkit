import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRefreshGate
} from '../ui/refresh-gate.js';

function deferred() {
  let resolve;

  const promise = new Promise(
    done => {
      resolve = done;
    }
  );

  return {
    promise,
    resolve
  };
}

test(
  'refresh gate never runs concurrent refreshes and coalesces a burst',
  async () => {
    let started = 0;
    let active = 0;
    let maxActive = 0;

    const releases = [];

    const gate =
      createRefreshGate(async () => {
        started += 1;
        active += 1;
        maxActive =
          Math.max(maxActive, active);

        const wait = deferred();
        releases.push(wait);

        await wait.promise;

        active -= 1;
      });

    const requests = [
      gate.request(),
      gate.request(),
      gate.request(),
      gate.request(),
      gate.request()
    ];

    assert.equal(started, 1);
    assert.equal(active, 1);
    assert.equal(maxActive, 1);
    assert.equal(gate.isInFlight(), true);

    releases[0].resolve();

    await new Promise(
      resolve => setImmediate(resolve)
    );

    assert.equal(
      started,
      2,
      'burst while refresh is in flight should become one pending refresh'
    );

    assert.equal(active, 1);
    assert.equal(
      maxActive,
      1,
      'refresh calls must never overlap'
    );

    releases[1].resolve();

    await Promise.all(requests);

    assert.equal(started, 2);
    assert.equal(active, 0);
    assert.equal(maxActive, 1);
    assert.equal(gate.isInFlight(), false);
  }
);

test(
  'refresh gate recovers after a failed refresh',
  async () => {
    let calls = 0;

    const gate =
      createRefreshGate(async () => {
        calls += 1;

        if (calls === 1) {
          throw new Error('synthetic refresh failure');
        }
      });

    await assert.rejects(
      gate.request(),
      /synthetic refresh failure/
    );

    assert.equal(gate.isInFlight(), false);

    await gate.request();

    assert.equal(calls, 2);
    assert.equal(gate.isInFlight(), false);
  }
);
