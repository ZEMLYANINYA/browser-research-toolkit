import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoundedStore, BoundedList } from '../../dist/storage/bounded-store.js';

test('BoundedStore evicts the oldest entries once over capacity', () => {
  const store = new BoundedStore(3);
  for (let i = 0; i < 5; i++) store.set(`k${i}`, { timestamp: i });

  assert.equal(store.size, 3);
  assert.deepEqual(
    store.entries().map(([k]) => k),
    ['k2', 'k3', 'k4'],
  );
});

test('BoundedStore evicts by TTL before falling back to size cap', () => {
  const store = new BoundedStore(10, 1000);
  const now = Date.now();
  store.set('old', { timestamp: now - 5000 });
  store.set('new', { timestamp: now });

  assert.equal(store.size, 1);
  assert.ok(store.has('new'));
});

test('BoundedList drops oldest items on overflow and counts the drops', () => {
  const list = new BoundedList(3);
  [1, 2, 3, 4, 5].forEach((n) => list.push(n));

  assert.equal(list.length, 3);
  assert.deepEqual(list.toArray(), [3, 4, 5]);
  assert.equal(list.droppedCount, 2);
});
