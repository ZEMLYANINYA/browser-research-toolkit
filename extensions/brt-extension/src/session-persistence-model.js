export const RECORD_BUCKETS = Object.freeze(['timeline', 'network']);

function recordKey(sessionId, bucket, item) {
  const sequence = Number(item?.sequence);

  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new TypeError(`${bucket} record requires a stable integer sequence.`);
  }

  return `${sessionId}:${bucket}:${sequence}`;
}

export function createPersistedRecord(sessionId, bucket, value) {
  if (!sessionId) {
    throw new TypeError('sessionId is required.');
  }

  if (!RECORD_BUCKETS.includes(bucket)) {
    throw new TypeError(`Unsupported record bucket: ${bucket}`);
  }

  const sequence = Number(value?.sequence);

  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new TypeError(`${bucket} record requires a stable integer sequence.`);
  }

  return {
    recordKey: recordKey(sessionId, bucket, value),
    sessionId,
    bucket,
    sequence,
    value
  };
}
export function decomposeSession(session) {
  if (!session || typeof session !== 'object') {
    throw new TypeError('session is required.');
  }

  if (!session.sessionId) {
    throw new TypeError('session.sessionId is required.');
  }

  const header = { ...session };
  const records = [];

  for (const bucket of RECORD_BUCKETS) {
    const items = Array.isArray(session[bucket]) ? session[bucket] : [];
    delete header[bucket];

    items.forEach(value => {
      records.push(createPersistedRecord(session.sessionId, bucket, value));
    });
  }

  return { header, records };
}

export function hydrateSession(header, records = []) {
  if (!header || typeof header !== 'object') return null;

  const session = {
    ...header,
    timeline: [],
    network: []
  };

  const grouped = new Map(RECORD_BUCKETS.map(bucket => [bucket, []]));

  for (const record of records) {
    if (!record || record.sessionId !== header.sessionId) continue;
    if (!grouped.has(record.bucket)) continue;
    grouped.get(record.bucket).push(record);
  }

  for (const bucket of RECORD_BUCKETS) {
    const items = grouped.get(bucket);

    items.sort((left, right) => {
      return Number(left.sequence) - Number(right.sequence);
    });

    session[bucket] = items.map(item => item.value);
  }

  return session;
}
