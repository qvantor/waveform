// worklet modules are bundled by esbuild (`npm run worklets`) and served next to the app assets
export const WORKLETS_PATH = 'assets/worklets/';

// AudioWorklet exists only in secure contexts (https, localhost) and not in old Safari
export const isWorkletSupported = (audioCtx: BaseAudioContext) =>
  Boolean(audioCtx.audioWorklet) && typeof AudioWorkletNode !== 'undefined';

const loaded = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();

// adds the module `name` (assets/worklets/<name>.js) to the context once, every effect awaits the same promise.
// Never throws: no audioWorklet rejects too. A failed load is forgotten, so the next call adds the module again
export const loadWorklet = (audioCtx: BaseAudioContext, name: string) => {
  const modules = loaded.get(audioCtx) ?? new Map<string, Promise<void>>();
  loaded.set(audioCtx, modules);
  const cached = modules.get(name);
  if (cached) return cached;
  const promise = new Promise<void>((resolve) =>
    resolve(audioCtx.audioWorklet.addModule(new URL(`${WORKLETS_PATH}${name}.js`, document.baseURI).href))
  );
  modules.set(name, promise);
  // attached first, so it runs before the callers learn about the failure and retry
  promise.catch(() => modules.delete(name));
  return promise;
};
