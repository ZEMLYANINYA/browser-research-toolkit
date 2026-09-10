import { decomposeSession } from './session-persistence-model.js';

export async function flushSessionToIndexedDb({
  session,
  deltaQueue,
  persistence,
  bootstrap = false
} = {}) {
  if (!session || typeof session !== 'object') {
    throw new TypeError('session is required.');
  }

  if (!deltaQueue || typeof deltaQueue.drain !== 'function' || typeof deltaQueue.requeue !== 'function') {
    throw new TypeError('deltaQueue with drain/requeue is required.');
  }

  if (!persistence || typeof persistence.writeBatch !== 'function') {
    throw new TypeError('persistence.writeBatch is required.');
  }

  const batch = deltaQueue.drain();
  const { header, records: retainedRecords } = decomposeSession(session);
  const records = bootstrap ? retainedRecords : batch.puts;

  try {
    await persistence.writeBatch({
      session: header,
      records,
      recordDeletes: bootstrap ? [] : batch.deletes,
      replaceRecordSessionId: bootstrap ? session.sessionId : null
    });
  } catch (error) {
    deltaQueue.requeue(batch);
    throw error;
  }

  return {
    bootstrap: Boolean(bootstrap),
    recordsWritten: records.length,
    recordsDeleted: batch.deletes.length
  };
}
