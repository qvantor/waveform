// worklet modules are bundled by esbuild (`npm run worklets`) and served next to the app assets
export const WORKLETS_PATH = 'assets/worklets/';

const loaded = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();

// adds the module `name` (assets/worklets/<name>.js) to the context once, every effect awaits the same promise
export const loadWorklet = (audioCtx: BaseAudioContext, name: string) => {
  const modules = loaded.get(audioCtx) ?? new Map<string, Promise<void>>();
  loaded.set(audioCtx, modules);
  let promise = modules.get(name);
  if (!promise) {
    promise = audioCtx.audioWorklet.addModule(new URL(`${WORKLETS_PATH}${name}.js`, document.baseURI).href);
    modules.set(name, promise);
  }
  return promise;
};
