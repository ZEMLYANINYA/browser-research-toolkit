export const MAX_PAGE_CONTINUITY_STREAMS = 64;

function normalizeContinuity(continuity) {
  const state = continuity && typeof continuity === 'object'
    ? continuity
    : {};

  state.pageStreams = Array.isArray(state.pageStreams)
    ? state.pageStreams
    : [];

  return state;
}

function streamKey({ generation, runId, documentId, frameId }) {
  return JSON.stringify([
    generation,
    runId,
    documentId,
    frameId
  ]);
}

export function observePageProducerSequence({
  continuity,
  generation,
  runId,
  documentId,
  frameId,
  producerSequence,
  observedAt = Date.now(),
  maxStreams = MAX_PAGE_CONTINUITY_STREAMS
} = {}) {
  const state = normalizeContinuity(continuity);
  const requestedLimit = Number(maxStreams);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.floor(requestedLimit))
    : MAX_PAGE_CONTINUITY_STREAMS;

  let evicted = [];

  if (state.pageStreams.length > limit) {
    state.pageStreams.sort((left, right) =>
      Number(left?.updatedAt || 0) - Number(right?.updatedAt || 0)
    );
    evicted = state.pageStreams.splice(0, state.pageStreams.length - limit);
  }

  if (!Number.isInteger(producerSequence) || producerSequence < 1) {
    return { state, status: 'ignored', gap: null, evicted };
  }

  if (!Number.isInteger(generation) || generation < 1) {
    return { state, status: 'ignored', gap: null, evicted };
  }

  if (typeof runId !== 'string' || !runId) {
    return { state, status: 'ignored', gap: null, evicted };
  }

  if (typeof documentId !== 'string' || !documentId || documentId === 'unknown') {
    return { state, status: 'ignored', gap: null, evicted };
  }

  if (!Number.isInteger(frameId) || frameId < 0) {
    return { state, status: 'ignored', gap: null, evicted };
  }

  const key = streamKey({ generation, runId, documentId, frameId });
  let cursor = state.pageStreams.find(item => item?.streamKey === key);

  if (!cursor) {
    cursor = {
      streamKey: key,
      generation,
      runId,
      documentId,
      frameId,
      lastProducerSequence: producerSequence,
      updatedAt: observedAt
    };

    state.pageStreams.push(cursor);

    if (state.pageStreams.length > limit) {
      state.pageStreams.sort((left, right) =>
        Number(left?.updatedAt || 0) - Number(right?.updatedAt || 0)
      );
      evicted.push(...state.pageStreams.splice(0, state.pageStreams.length - limit));
    }

    return { state, status: 'new-stream', gap: null, evicted };
  }

  const previous = Number(cursor.lastProducerSequence);

  if (!Number.isInteger(previous) || previous < 1) {
    cursor.lastProducerSequence = producerSequence;
    cursor.updatedAt = observedAt;
    return { state, status: 'advanced', gap: null, evicted };
  }

  if (producerSequence <= previous) {
    cursor.updatedAt = observedAt;
    return { state, status: 'duplicate-or-out-of-order', gap: null, evicted };
  }

  const expectedProducerSequence = previous + 1;
  cursor.lastProducerSequence = producerSequence;
  cursor.updatedAt = observedAt;

  if (producerSequence === expectedProducerSequence) {
    return { state, status: 'advanced', gap: null, evicted };
  }

  return {
    state,
    status: 'gap',
    evicted,
    gap: {
      expectedProducerSequence,
      receivedProducerSequence: producerSequence,
      missingCount: producerSequence - expectedProducerSequence,
      generation,
      runId,
      documentId,
      frameId,
      provenance: 'page-observable'
    }
  };
}
