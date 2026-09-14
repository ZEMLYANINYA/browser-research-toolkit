export function createRefreshGate(run) {
  if (typeof run !== 'function') {
    throw new TypeError('run is required.');
  }

  let inFlight = null;
  let pending = false;

  function request() {
    if (inFlight) {
      pending = true;
      return inFlight;
    }

    inFlight = (async () => {
      try {
        do {
          pending = false;
          await run();
        } while (pending);
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  return Object.freeze({
    request,

    isInFlight() {
      return inFlight !== null;
    }
  });
}
