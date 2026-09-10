export function createRecordDelta() {
  const puts = new Map();
  const deletes = new Set();

  function put(record) {
    if (!record?.recordKey) {
      throw new TypeError('record.recordKey is required.');
    }

    deletes.delete(record.recordKey);
    puts.set(record.recordKey, record);
  }

  function remove(recordKey) {
    if (!recordKey) {
      throw new TypeError('recordKey is required.');
    }

    puts.delete(recordKey);
    deletes.add(recordKey);
  }

  function snapshot() {
    return {
      puts: [...puts.values()],
      deletes: [...deletes]
    };
  }

  function clear() {
    puts.clear();
    deletes.clear();
  }

  function isEmpty() {
    return puts.size === 0 && deletes.size === 0;
  }

  return Object.freeze({
    put,
    remove,
    snapshot,
    clear,
    isEmpty
  });
}
