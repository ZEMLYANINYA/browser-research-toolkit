/**
 * Small in-memory limiter used by extension-originated operations.
 *
 * The limiter is intentionally keyed (normally by service/hostname), so a
 * noisy site cannot make every other operation wait. It does not touch page
 * instrumentation or observed network events.
 */

function normalizeNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function normalizePositive(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, number) : fallback;
}

function abortError(message = 'Rate-limited operation cancelled.') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'TASK_CANCELLED';
  return error;
}

export class RateLimitError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'RateLimitError';
    this.code = code;
    this.retryable = options.retryable !== false;
  }
}

export class RateLimiter {
  constructor({ defaultMinIntervalMs = 0, defaultMaxConcurrent = Infinity, defaultMaxQueue = 100 } = {}) {
    this.defaultMinIntervalMs = normalizeNonNegative(defaultMinIntervalMs);
    this.defaultMaxConcurrent = normalizePositive(defaultMaxConcurrent, Infinity);
    this.defaultMaxQueue = normalizePositive(defaultMaxQueue, 100);
    this.buckets = new Map();
  }

  getBucket(key, options = {}) {
    const bucketKey = String(key || 'default');
    let bucket = this.buckets.get(bucketKey);
    const requestedMinInterval = normalizeNonNegative(options.minIntervalMs, this.defaultMinIntervalMs);
    const requestedMaxConcurrent = normalizePositive(options.maxConcurrent, this.defaultMaxConcurrent);
    const requestedMaxQueue = normalizePositive(options.maxQueue, this.defaultMaxQueue);
    if (!bucket) {
      bucket = {
        key: bucketKey,
        minIntervalMs: requestedMinInterval,
        maxConcurrent: requestedMaxConcurrent,
        maxQueue: requestedMaxQueue,
        active: 0,
        queued: [],
        lastStartedAt: 0,
        timer: null
      };
      this.buckets.set(bucketKey, bucket);
    } else {
      // A key may be used by more than one operation type. Honor the
      // strictest policy seen for that key instead of accidentally relaxing
      // an existing throttle.
      bucket.minIntervalMs = Math.max(bucket.minIntervalMs, requestedMinInterval);
      bucket.maxConcurrent = Math.min(bucket.maxConcurrent, requestedMaxConcurrent);
      bucket.maxQueue = Math.min(bucket.maxQueue, requestedMaxQueue);
    }
    return bucket;
  }

  acquire(key = 'default', options = {}) {
    const bucket = this.getBucket(key, options);
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(abortError());
    const intervalBlocked = bucket.lastStartedAt > 0 && bucket.lastStartedAt + bucket.minIntervalMs > Date.now();
    const blocked = bucket.active >= bucket.maxConcurrent || intervalBlocked || bucket.queued.length > 0;
    // Number of waiting entries, including this request, only when it cannot
    // start immediately. Active work is not counted when a concurrency slot
    // is still available.
    const queueDepthAtEnqueue = blocked ? bucket.queued.length + 1 : 0;

    const promise = new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        signal,
        abortHandler: null,
        started: false,
        queueDepth: queueDepthAtEnqueue,
        queuedAt: Date.now()
      };
      entry.abortHandler = () => this.cancelQueued(bucket, entry);
      signal?.addEventListener('abort', entry.abortHandler, { once: true });

      if (bucket.queued.length >= bucket.maxQueue) {
        this.cleanupEntry(entry);
        const error = new RateLimitError(
          'RATE_LIMIT_QUEUE_FULL',
          `Rate-limit queue is full for ${bucket.key}.`,
          { retryable: true }
        );
        error.rateKey = bucket.key;
        error.queueDepth = entry.queueDepth;
        reject(error);
        return;
      }

      bucket.queued.push(entry);
      this.drain(bucket);
    });
    // Expose the snapshot synchronously so TaskRunner can show queue depth
    // while an acquisition is still waiting for a slot.
    promise.rateKey = bucket.key;
    promise.queueDepth = queueDepthAtEnqueue;
    return promise;
  }

  cleanupEntry(entry) {
    entry.signal?.removeEventListener('abort', entry.abortHandler);
  }

  cancelQueued(bucket, entry) {
    if (entry.started) return;
    const index = bucket.queued.indexOf(entry);
    if (index < 0) return;
    bucket.queued.splice(index, 1);
    this.cleanupEntry(entry);
    entry.reject(abortError());
    this.drain(bucket);
  }

  start(bucket, entry) {
    entry.started = true;
    this.cleanupEntry(entry);
    bucket.active += 1;
    bucket.lastStartedAt = Date.now();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      bucket.active = Math.max(0, bucket.active - 1);
      this.drain(bucket);
    };
    // Metadata is attached to the release function so TaskRunner can expose
    // queue wait without coupling the limiter to task/session storage.
    release.rateKey = bucket.key;
    release.queueDepth = entry.queueDepth;
    release.queuedAt = entry.queuedAt;
    release.startedAt = bucket.lastStartedAt;
    entry.resolve(release);
  }

  drain(bucket) {
    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }
    if (!bucket.queued.length || bucket.active >= bucket.maxConcurrent) return;

    const waitMs = Math.max(0, bucket.lastStartedAt + bucket.minIntervalMs - Date.now());
    if (waitMs > 0) {
      bucket.timer = setTimeout(() => {
        bucket.timer = null;
        this.drain(bucket);
      }, waitMs);
      return;
    }

    // With no interval, fill all available concurrency slots immediately.
    while (bucket.queued.length && bucket.active < bucket.maxConcurrent) {
      const entry = bucket.queued.shift();
      if (entry.signal?.aborted) {
        this.cleanupEntry(entry);
        entry.reject(abortError());
        continue;
      }
      this.start(bucket, entry);
      if (bucket.minIntervalMs > 0) break;
    }
  }

  getStats(key = 'default') {
    const bucket = this.buckets.get(String(key || 'default'));
    if (!bucket) return { key: String(key || 'default'), active: 0, queued: 0, minIntervalMs: 0, maxConcurrent: 0 };
    return {
      key: bucket.key,
      active: bucket.active,
      queued: bucket.queued.length,
      minIntervalMs: bucket.minIntervalMs,
      maxConcurrent: bucket.maxConcurrent,
      lastStartedAt: bucket.lastStartedAt
    };
  }
}
