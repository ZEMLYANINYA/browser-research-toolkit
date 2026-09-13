import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityDeltaQueue } from '../src/entity-delta-queue.js';

function entity(id, value = id) {
  return {
    entityKey: `session-a:source:${id}`,
    sessionId: 'session-a',
    bucket: 'source',
    value: { id, value }
  };
}

test('drain detaches entity mutations from subsequent writes', () => {
  const queue = createEntityDeltaQueue();
  const first = entity('one');
  const second = entity('two');

  queue.put(first);
  const drained = queue.drain();
  queue.put(second);

  assert.deepEqual(drained, { puts: [first], deletes: [] });
  assert.deepEqual(queue.snapshot(), { puts: [second], deletes: [] });
});

test('newer delete wins when an older failed put is requeued', () => {
  const queue = createEntityDeltaQueue();
  const oldEntity = entity('one', 'old');

  queue.put(oldEntity);
  const failed = queue.drain();
  queue.remove(oldEntity.entityKey);
  queue.requeue(failed);

  assert.deepEqual(queue.snapshot(), {
    puts: [],
    deletes: [oldEntity.entityKey]
  });
});

test('newer put wins when an older failed delete is requeued', () => {
  const queue = createEntityDeltaQueue();
  const newer = entity('one', 'new');

  queue.remove(newer.entityKey);
  const failed = queue.drain();
  queue.put(newer);
  queue.requeue(failed);

  assert.deepEqual(queue.snapshot(), {
    puts: [newer],
    deletes: []
  });
});

test('last mutation wins inside the active entity delta', () => {
  const queue = createEntityDeltaQueue();
  const first = entity('one', 'first');
  const second = entity('one', 'second');

  queue.put(first);
  queue.remove(first.entityKey);
  queue.put(second);

  assert.deepEqual(queue.snapshot(), {
    puts: [second],
    deletes: []
  });
});

test('invalid requeue input is rejected without changing active state', () => {
  const queue = createEntityDeltaQueue();
  const current = entity('one');

  queue.put(current);

  assert.throws(
    () => queue.requeue({ puts: null, deletes: [] }),
    /delta with puts\/deletes is required/
  );

  assert.deepEqual(queue.snapshot(), { puts: [current], deletes: [] });
});
