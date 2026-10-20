// how many times the worklet module `name` was added (assets/worklets/<name>.js, or <name>.wasm.js with its wasm
// core): the synth core adds the limiter module too
export const workletLoads = (addModule: jest.Mock, name: string) =>
  addModule.mock.calls.filter(([url]) => /\/([^/]+?)(\.wasm)?\.js$/.exec(String(url))?.[1] === name).length;
