interface Shared<T> {
  promise: Promise<T>;
  controller: AbortController;
  // the callers waiting for it (one without a signal waits to its end)
  waiting: number;
  settled: boolean;
}

// loads by their ids for the session, shared by their callers (both oscillators on one table): a failed one is
// dropped, so the next call loads it again; a caller whose signal aborts gets its reason at once, and a load every
// caller gave up (a newer path, the model stopped) is aborted, its download too, and dropped: on a slow line the
// loads no one waits for any more would share it with the one played
export const sharedLoads = <T>(load: (id: string, signal: AbortSignal) => Promise<T>) => {
  const loads = new Map<string, Shared<T>>();
  const drop = (id: string, shared: Shared<T>) => {
    if (loads.get(id) === shared) loads.delete(id);
  };
  return (id: string, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let shared = loads.get(id);
    if (!shared) {
      const controller = new AbortController();
      const created: Shared<T> = {
        promise: load(id, controller.signal),
        controller,
        waiting: 0,
        settled: false,
      };
      created.promise.then(
        () => (created.settled = true),
        () => {
          created.settled = true;
          drop(id, created);
        }
      );
      loads.set(id, created);
      shared = created;
    }
    if (shared.settled) return shared.promise;
    const waited = shared;
    waited.waiting++;
    if (!signal) return waited.promise;
    return new Promise<T>((resolve, reject) => {
      const leave = () => {
        reject(signal.reason);
        if (--waited.waiting > 0 || waited.settled) return;
        drop(id, waited);
        waited.controller.abort(signal.reason);
      };
      signal.addEventListener('abort', leave, { once: true });
      waited.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', leave));
    });
  };
};
