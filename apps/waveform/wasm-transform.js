// the bytes of a wasm core in a spec that imports a wasm worklet bundle (@waveform/wasm/<name>.wasm, mapped to
// tmp/wasm-perf in jest.config.ts), as esbuild's binary loader inlines them into the bundle
module.exports = {
  process: (_, filename) => ({
    code: `module.exports = { __esModule: true, default: require('fs').readFileSync(${JSON.stringify(
      filename
    )}) };`,
  }),
};
