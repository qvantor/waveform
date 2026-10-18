import { BuilderMessage, BuilderStatsMessage, createTableBuilder } from './wavetable-builder';

// the Web Worker that builds the levels of the wavetables (wavetable-builder.ts), bundled by esbuild (`npm run
// worklets`) into assets/worklets/wavetable-worker.js; no window, document or React

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BuilderMessage>) => void) | null;
  postMessage: (message: BuilderStatsMessage) => void;
};
const builder = createTableBuilder(undefined, (message) => scope.postMessage(message));
scope.onmessage = ({ data }) => builder.receive(data);
