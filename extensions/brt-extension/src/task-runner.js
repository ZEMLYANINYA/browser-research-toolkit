import { RateLimiter } from './rate-limiter.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timed_out']);

export class TaskError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'TaskError';
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.cause = options.cause;
  }
}

function makeTaskId(name = 'task') {
  return `task_${name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isAbort(error) {
  return error?.name === 'AbortError' || error?.code === 'TASK_CANCELLED';
}

export class TaskRunner {
  constructor({ onUpdate, rateLimiter = new RateLimiter() } = {}) {
    this.tasks = new Map();
    this.waiters = new Map();
    this.onUpdate = typeof onUpdate === 'function' ? onUpdate : () => {};
    this.rateLimiter = rateLimiter;
  }

  snapshot(task) {
    const { controller, ...safe } = task;
    return { ...safe, cancelable: !TERMINAL.has(task.status) };
  }

  publish(task, patch = {}) {
    Object.assign(task, patch, { updatedAt: Date.now() });
    this.onUpdate(this.snapshot(task));
    return task;
  }

  run({ name = 'task', tabId = null, runId = null, timeoutMs = 30_000, maxAttempts = 1, retryDelayMs = 500, backoff = 2, metadata = {}, rateKey = null, rateLimit = {}, execute }) {
    if (typeof execute !== 'function') throw new TypeError('Task execute function is required.');
    const queuedAt = Date.now();
    const task = {
      taskId: makeTaskId(name), name, tabId, runId, metadata: { ...metadata },
      status: 'queued', attempt: 0, maxAttempts: Math.max(1, Number(maxAttempts) || 1),
      timeoutMs: Math.max(1, Number(timeoutMs) || 30_000), retryDelayMs: Math.max(0, Number(retryDelayMs) || 0),
      backoff: Math.max(1, Number(backoff) || 1), rateKey: rateKey ? String(rateKey).slice(0, 200) : null,
      rateLimit: { ...rateLimit }, createdAt: queuedAt, updatedAt: queuedAt,
      queuedAt, startedAt: null, waitMs: 0, queueDepth: 0,
      rateLimited: false, queueFullCount: 0,
      controller: new AbortController(), result: null, error: null
    };
    this.tasks.set(task.taskId, task);
    this.publish(task);
    task.promise = this.execute(task, execute);
    task.promise.taskId = task.taskId;
    return task.promise;
  }

  async execute(task, execute) {
    while (task.attempt < task.maxAttempts) {
      task.attempt += 1;
      if (task.controller.signal.aborted) return this.finish(task, 'cancelled', null, new TaskError('TASK_CANCELLED', 'Task cancelled.'));
      this.publish(task, { status: task.attempt === 1 ? 'running' : 'retrying', error: null });
      try {
        const result = await this.withTimeout(task, execute);
        return this.finish(task, 'completed', result, null);
      } catch (error) {
        if (task.controller.signal.aborted || isAbort(error)) {
          const cancelled = error?.code === 'TASK_TIMEOUT' ? 'timed_out' : 'cancelled';
          this.finish(task, cancelled, null, error);
          throw error;
        }
        const retryable = error?.retryable === true || error?.code === 'TASK_NETWORK' || error?.code === 'TASK_TIMEOUT';
        if (!retryable || task.attempt >= task.maxAttempts) {
          this.finish(task, error?.code === 'TASK_TIMEOUT' ? 'timed_out' : 'failed', null, error);
          throw error;
        }
        const delay = task.retryDelayMs * (task.backoff ** (task.attempt - 1));
        this.publish(task, { status: 'retrying', error: this.serializeError(error), nextRetryAt: Date.now() + delay });
        await this.delay(delay, task.controller.signal);
      }
    }
    const error = new TaskError('TASK_INTERNAL', 'Task exited without a result.');
    this.finish(task, 'failed', null, error);
    throw error;
  }

  async withTimeout(task, execute) {
    const timeoutController = new AbortController();
    const onAbort = () => timeoutController.abort();
    task.controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => timeoutController.abort(), task.timeoutMs);
    let release = null;
    const attemptQueuedAt = Date.now();
    const run = async () => {
      if (task.rateKey && this.rateLimiter) {
        try {
          const acquisition = this.rateLimiter.acquire(task.rateKey, { signal: timeoutController.signal, ...task.rateLimit });
          task.queueDepth = Number(acquisition.queueDepth) || 0;
          if (task.queueDepth > 0) {
            task.rateLimited = true;
            this.publish(task, { queueDepth: task.queueDepth, rateLimited: true, rateKey: task.rateKey });
          }
          release = await acquisition;
        } catch (error) {
          if (error?.code === 'RATE_LIMIT_QUEUE_FULL') {
            task.queueDepth = Number(error.queueDepth) || task.queueDepth || 0;
            task.rateLimited = true;
            task.queueFullCount += 1;
            this.publish(task, {
              queueDepth: task.queueDepth,
              rateLimited: true,
              queueFullCount: task.queueFullCount,
              rateKey: task.rateKey
            });
          }
          throw error;
        }
        const startedAt = Number(release?.startedAt) || Date.now();
        const waitMs = Math.max(0, startedAt - attemptQueuedAt);
        if (!task.startedAt) task.startedAt = startedAt;
        task.waitMs += waitMs;
        task.queueDepth = Number(release?.queueDepth) || 0;
        task.rateLimited = task.rateLimited || waitMs > 0 || task.queueDepth > 0;
        this.publish(task, {
          startedAt: task.startedAt,
          waitMs: task.waitMs,
          queueDepth: task.queueDepth,
          rateLimited: task.rateLimited,
          rateKey: task.rateKey
        });
      } else if (!task.startedAt) {
        task.startedAt = Date.now();
        this.publish(task, { startedAt: task.startedAt, waitMs: task.waitMs, queueDepth: 0 });
      }
      try {
        return await execute({ signal: timeoutController.signal, taskId: task.taskId, attempt: task.attempt, runId: task.runId });
      } finally {
        release?.();
        release = null;
      }
    };
    try {
      const result = await Promise.race([
        Promise.resolve().then(run),
        new Promise((_, reject) => timeoutController.signal.addEventListener('abort', () => reject(new TaskError('TASK_TIMEOUT', `Task timed out after ${task.timeoutMs} ms.`, { retryable: true })), { once: true }))
      ]);
      return result;
    } finally {
      clearTimeout(timer);
      task.controller.signal.removeEventListener('abort', onAbort);
    }
  }

  delay(ms, signal) {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const abort = () => { clearTimeout(timer); reject(new TaskError('TASK_CANCELLED', 'Task cancelled.')); };
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  finish(task, status, result, error) {
    if (TERMINAL.has(task.status)) return task.promise;
    task.result = result;
    task.error = error ? this.serializeError(error) : null;
    this.publish(task, { status, result, error: task.error, finishedAt: Date.now() });
    const waiter = this.waiters.get(task.taskId);
    if (waiter) {
      this.waiters.delete(task.taskId);
      error ? waiter.reject(error) : waiter.resolve(result);
    }
    return result;
  }

  cancel(taskId, reason = 'Task cancelled by user.') {
    const task = this.tasks.get(taskId);
    if (!task || TERMINAL.has(task.status)) return false;
    task.controller.abort();
    this.publish(task, { status: 'cancelled', error: this.serializeError(new TaskError('TASK_CANCELLED', reason)) });
    const waiter = this.waiters.get(taskId);
    if (waiter) { this.waiters.delete(taskId); waiter.reject(new TaskError('TASK_CANCELLED', reason)); }
    return true;
  }

  cancelRun(runId, reason = 'Run cancelled.') {
    let count = 0;
    for (const task of this.tasks.values()) if (task.runId === runId && this.cancel(task.taskId, reason)) count += 1;
    return count;
  }

  waitForResult(taskId, signal) {
    const task = this.tasks.get(taskId);
    if (!task) return Promise.reject(new TaskError('TASK_NOT_FOUND', 'Task not found.'));
    if (TERMINAL.has(task.status)) return task.error ? Promise.reject(task.error) : Promise.resolve(task.result);
    return new Promise((resolve, reject) => {
      const abort = () => { this.waiters.delete(taskId); reject(new TaskError('TASK_CANCELLED', 'Task cancelled.')); };
      this.waiters.set(taskId, { resolve, reject });
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  resolveExternal(taskId, result) {
    const waiter = this.waiters.get(taskId);
    if (!waiter) return false;
    this.waiters.delete(taskId);
    waiter.resolve(result);
    return true;
  }

  rejectExternal(taskId, error) {
    const waiter = this.waiters.get(taskId);
    if (!waiter) return false;
    this.waiters.delete(taskId);
    waiter.reject(error instanceof Error ? error : new TaskError('TASK_EXTERNAL', String(error || 'External task failed.')));
    return true;
  }

  get(taskId) { const task = this.tasks.get(taskId); return task ? this.snapshot(task) : null; }
  list({ tabId = null, runId = null } = {}) { return [...this.tasks.values()].filter(task => (tabId == null || task.tabId === tabId) && (runId == null || task.runId === runId)).map(task => this.snapshot(task)); }

  serializeError(error) {
    return { code: error?.code || 'TASK_FAILED', name: error?.name || 'Error', message: String(error?.message || error || 'Task failed'), retryable: Boolean(error?.retryable) };
  }
}

export { TERMINAL };
