export function createSessionUpdateBroadcaster({
  sendMessage,
  delay = 400,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof sendMessage !== 'function') {
    throw new TypeError('sendMessage is required.');
  }

  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('timer functions are required.');
  }

  const pending = new Map();

  function schedule(tabId) {
    if (!Number.isInteger(tabId)) return false;
    if (pending.has(tabId)) return false;

    const timer = setTimer(async () => {
      pending.delete(tabId);

      try {
        await sendMessage({
          type: 'BRT_SESSION_UPDATED',
          tabId
        });
      } catch {
        // The side panel may be closed. Session persistence must not
        // depend on a live UI listener.
      }
    }, delay);

    pending.set(tabId, timer);
    return true;
  }

  function cancel(tabId) {
    const timer = pending.get(tabId);
    if (timer == null) return false;

    clearTimer(timer);
    pending.delete(tabId);
    return true;
  }

  function cancelAll() {
    for (const timer of pending.values()) {
      clearTimer(timer);
    }

    pending.clear();
  }

  return Object.freeze({
    schedule,
    cancel,
    cancelAll,
    hasPending(tabId) {
      return pending.has(tabId);
    }
  });
}
