function createDelta() {
  return {
    puts: new Map(),
    deletes: new Set()
  };
}

export function createEntityDeltaQueue() {
  let active = createDelta();

  function put(entity) {
    if (!entity?.entityKey) {
      throw new TypeError('entity.entityKey is required.');
    }

    active.deletes.delete(entity.entityKey);
    active.puts.set(entity.entityKey, entity);
  }

  function remove(entityKey) {
    if (typeof entityKey !== 'string' || !entityKey) {
      throw new TypeError('entityKey is required.');
    }

    active.puts.delete(entityKey);
    active.deletes.add(entityKey);
  }

  function drain() {
    const drained = active;
    active = createDelta();

    return {
      puts: [...drained.puts.values()],
      deletes: [...drained.deletes]
    };
  }

  function requeue(delta) {
    if (!delta || !Array.isArray(delta.puts) || !Array.isArray(delta.deletes)) {
      throw new TypeError('delta with puts/deletes is required.');
    }

    const failed = createDelta();

    for (const entity of delta.puts) {
      if (!entity?.entityKey) continue;
      failed.puts.set(entity.entityKey, entity);
    }

    for (const entityKey of delta.deletes) {
      if (typeof entityKey !== 'string' || !entityKey) continue;
      failed.puts.delete(entityKey);
      failed.deletes.add(entityKey);
    }

    for (const [entityKey, entity] of active.puts) {
      failed.deletes.delete(entityKey);
      failed.puts.set(entityKey, entity);
    }

    for (const entityKey of active.deletes) {
      failed.puts.delete(entityKey);
      failed.deletes.add(entityKey);
    }

    active = failed;
  }

  function snapshot() {
    return {
      puts: [...active.puts.values()],
      deletes: [...active.deletes]
    };
  }

  function isEmpty() {
    return active.puts.size === 0 && active.deletes.size === 0;
  }

  return Object.freeze({
    put,
    remove,
    drain,
    requeue,
    snapshot,
    isEmpty
  });
}
