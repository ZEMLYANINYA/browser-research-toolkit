import { createRecordDelta } from './record-delta.js';

function applySnapshot(delta, snapshot) {
  for (const record of snapshot.puts || []) {
    delta.put(record);
  }

  for (const recordKey of snapshot.deletes || []) {
    delta.remove(recordKey);
  }
}

export function createRecordDeltaQueue() {
  let active = createRecordDelta();

  function put(record) {
    active.put(record);
  }

  function remove(recordKey) {
    active.remove(recordKey);
  }

  function snapshot() {
    return active.snapshot();
  }

  function isEmpty() {
    return active.isEmpty();
  }

  function drain() {
    const batch = active.snapshot();
    active = createRecordDelta();
    return batch;
  }

  function requeue(batch) {
    if (!batch || !Array.isArray(batch.puts) || !Array.isArray(batch.deletes)) {
      throw new TypeError('Valid drained batch is required.');
    }

    const newer = active.snapshot();
    active = createRecordDelta();

    // Reapply the failed older batch first, then replay mutations that
    // arrived while the durable write was in flight. Newer state wins.
    applySnapshot(active, batch);
    applySnapshot(active, newer);
  }

  return Object.freeze({
    put,
    remove,
    snapshot,
    isEmpty,
    drain,
    requeue
  });
}
