import test from 'node:test';
import assert from 'node:assert/strict';

import { sessionDurationMs } from '../ui/dashboard-metrics.js';

test('sessionDurationMs returns zero when a session has never started', () => {
  assert.equal(
    sessionDurationMs({
      startedAt: null,
      updatedAt: Date.now(),
      running: false,
      timeline: []
    }),
    0
  );

  assert.equal(
    sessionDurationMs({
      startedAt: 0,
      updatedAt: Date.now(),
      running: false,
      timeline: []
    }),
    0
  );
});

test('sessionDurationMs falls back to retained timeline bounds when startedAt is missing', () => {
  assert.equal(
    sessionDurationMs({
      startedAt: null,
      updatedAt: null,
      running: false,
      timeline: [
        { wallTime: 1_000 },
        { wallTime: 2_500 }
      ]
    }),
    1_500
  );
});

test('sessionDurationMs prefers valid session lifecycle timestamps', () => {
  assert.equal(
    sessionDurationMs({
      startedAt: 10_000,
      updatedAt: 14_250,
      running: false,
      timeline: [
        { wallTime: 10_500 },
        { wallTime: 13_000 }
      ]
    }),
    4_250
  );
});
