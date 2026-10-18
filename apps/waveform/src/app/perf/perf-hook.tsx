// the test hook of the perf build: nothing in the app. The `perf` configuration of the build (project.json)
// replaces this module with perf-hook.perf.tsx, which puts window.__waveformPerf on the page for
// scripts/bench-perf; the production bundle never has it
export const PerfHook = () => null;
