import test from 'node:test';
import assert from 'node:assert/strict';

import { createRecordDeltaQueue } from '../src/record-delta-queue.js';

test('drain detaches the current batch and starts a fresh accumulator', () => {
  const queue = createRecordDeltaQueue();
  const first = { recordKey: 's:timeline:1', value: { kind: 'first' } };

  queue.put(first);
  const drained = queue.drain();

  assert.deepEqual(drained, { puts: [first], deletes: [] });
  assert.equal(queue.isEmpty(), true);
});

test('mutations arriving after drain stay out of the in-flight batch', () => {
  const queue = createRecordDeltaQueue();
  const first = { recordKey: 's:timeline:1' };
  const second = { recordKey: 's:timeline:2' };

  queue.put(first);
  const drained = queue.drain();
  queue.put(second);

  assert.deepEqual(drained, { puts: [first], deletes: [] });
  assert.deepEqual(queue.snapshot(), { puts: [second], deletes: [] });
});

test('newer delete wins when an older failed put is requeued', () => {
  const queue = createRecordDeltaQueue();
  const key = 's:timeline:1';

  queue.put({ recordKey: key, value: { kind: 'old' } });
  const failed = queue.drain();

  queue.remove(key);
  queue.requeue(failed);

  assert.deepEqual(queue.snapshot(), {
    puts: [],
    deletes: [key]
  });
});

test('newer put wins when an older failed delete is requeued', () => {
  const queue = createRecordDeltaQueue();
  const key = 's:timeline:1';
  const newer = { recordKey: key, value: { kind: 'new' } };

  queue.remove(key);
  const failed = queue.drain();

  queue.put(newer);
  queue.requeue(failed);

  assert.deepEqual(queue.snapshot(), {
    puts: [newer],
    deletes: []
  });
});

test('requeue restores unrelated failed and newer mutations together', () => {
  const queue = createRecordDeltaQueue();

  queue.put({ recordKey: 's:timeline:1' });
  queue.remove('s:network:2');
  const failed = queue.drain();

  queue.put({ recordKey: 's:timeline:3' });
  queue.requeue(failed);

  assert.deepEqual(queue.snapshot(), {
    puts: [
      { recordKey: 's:timeline:1' },
      { recordKey: 's:timeline:3' }
    ],
    deletes: ['s:network:2']
  });
});

test('successive drains are independent', () => {
  const queue = createRecordDeltaQueue();

  queue.put({ recordKey: 's:timeline:1' });
  const first = queue.drain();

  queue.put({ recordKey: 's:timeline:2' });
  const second = queue.drain();

  assert.deepEqual(first.puts.map(item => item.recordKey), ['s:timeline:1']);
  assert.deepEqual(second.puts.map(item => item.recordKey), ['s:timeline:2']);
  assert.equal(queue.isEmpty(), true);
});

test('invalid requeue input is rejected without changing active state', () => {
  const queue = createRecordDeltaQueue();
  const record = { recordKey: 's:timeline:1' };

  queue.put(record);

  assert.throws(() => queue.requeue({}), /Valid drained batch is required/);
  assert.deepEqual(queue.snapshot(), { puts: [record], deletes: [] });
});
