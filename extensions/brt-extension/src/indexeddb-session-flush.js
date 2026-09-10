import { decomposeSession } from './session-persistence-model.js';
import { decomposeSessionEntities } from './session-entity-model.js';

export async function flushSessionToIndexedDb({
  session,
  deltaQueue,
  entityDeltaQueue,
  persistence,
  bootstrap = false
} = {}) {
  if (!session || typeof session !== 'object') {
    throw new TypeError('session is required.');
  }

  if (!deltaQueue || typeof deltaQueue.drain !== 'function' || typeof deltaQueue.requeue !== 'function') {
    throw new TypeError('deltaQueue with drain/requeue is required.');
  }

  if (!entityDeltaQueue || typeof entityDeltaQueue.drain !== 'function' || typeof entityDeltaQueue.requeue !== 'function') {
    throw new TypeError('entityDeltaQueue with drain/requeue is required.');
  }

  if (!persistence || typeof persistence.writeBatch !== 'function') {
    throw new TypeError('persistence.writeBatch is required.');
  }

  const activeSession = {
    tabId: session.tabId,
    sessionId: session.sessionId,
    updatedAt: Date.now()
  };

  const batch = deltaQueue.drain();
  const entityBatch = entityDeltaQueue.drain();
  const { header: recordHeader, records: retainedRecords } = decomposeSession(session);
  const { header, entities: retainedEntities } = decomposeSessionEntities(recordHeader);
  const records = bootstrap ? retainedRecords : batch.puts;
  const entities = bootstrap ? retainedEntities : entityBatch.puts;

  try {
    await persistence.writeBatch({
      session: header,
      activeSession,
      records,
      recordDeletes: bootstrap ? [] : batch.deletes,
      entities,
      entityDeletes: bootstrap ? [] : entityBatch.deletes,
      replaceRecordSessionId: bootstrap ? session.sessionId : null,
      replaceEntitySessionId: bootstrap ? session.sessionId : null
    });
  } catch (error) {
    deltaQueue.requeue(batch);
    entityDeltaQueue.requeue(entityBatch);
    throw error;
  }

  return {
    bootstrap: Boolean(bootstrap),
    recordsWritten: records.length,
    recordsDeleted: batch.deletes.length,
    entitiesWritten: entities.length,
    entitiesDeleted: entityBatch.deletes.length
  };
}
