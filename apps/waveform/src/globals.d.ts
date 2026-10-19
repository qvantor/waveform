// true in the perf build only (`npm run build:perf`, scripts/bench-perf): the code of the perf suite under it (the
// counters of the voices and the tables, the timing of the notes) is dead in every other build and dropped by the
// minifier. Defined by the webpack config of the app (webpack.config.js), by esbuild for the worklets and the
// worker (`npm run worklets`: false; `build:perf`: true), true in the specs (jest.config.ts)
declare const __PERF__: boolean;
