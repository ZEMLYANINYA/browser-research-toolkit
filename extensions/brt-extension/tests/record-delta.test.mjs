import test from 'node:test';
import assert from 'node:assert/strict';

import { createRecordDelta } from '../src/record-delta.js';

test('put records are retained by recordKey', () => {
  const delta = createRecordDelta();
  const record = { recordKey: 's:timeline:1', value: { kind: 'click' } };

  delta.put(record);

  assert.deepEqual(delta.snapshot(), {
    puts: [record],
    deletes: []
  });
});

test('later put replaces an earlier put for the same key', () => {
  const delta = createRecordDelta();

  delta.put({ recordKey: 's:timeline:1', value: { version: 1 } });
  delta.put({ recordKey: 's:timeline:1', value: { version: 2 } });

  assert.deepEqual(delta.snapshot(), {
    puts: [{ recordKey: 's:timeline:1', value: { version: 2 } }],
    deletes: []
  });
});

test('delete cancels a pending put for the same key', () => {
  const delta = createRecordDelta();

  delta.put({ recordKey: 's:timeline:1', value: { kind: 'click' } });
  delta.remove('s:timeline:1');

  assert.deepEqual(delta.snapshot(), {
    puts: [],
    deletes: ['s:timeline:1']
  });
});

test('put after delete cancels the tombstone', () => {
  const delta = createRecordDelta();

  delta.remove('s:timeline:1');
  delta.put({ recordKey: 's:timeline:1', value: { kind: 'click' } });

  assert.deepEqual(delta.snapshot(), {
    puts: [{ recordKey: 's:timeline:1', value: { kind: 'click' } }],
    deletes: []
  });
});

test('clear resets the accumulator after durable commit', () => {
  const delta = createRecordDelta();

  delta.put({ recordKey: 's:timeline:1' });
  delta.remove('s:network:2');

  assert.equal(delta.isEmpty(), false);
  delta.clear();
  assert.equal(delta.isEmpty(), true);
  assert.deepEqual(delta.snapshot(), { puts: [], deletes: [] });
});

test('invalid record identity is rejected', () => {
  const delta = createRecordDelta();

  assert.throws(() => delta.put({}), /record\.recordKey is required/);
  assert.throws(() => delta.remove(''), /recordKey is required/);
});
