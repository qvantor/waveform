export interface WorkletProcessorStub {
  port: { onmessage: (event: { data: unknown }) => void };
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
}

type ProcessorClass = new (options: AudioWorkletNodeOptions) => WorkletProcessorStub;

// the AudioWorkletGlobalScope a worklet module runs in; returns the processors it registers, by name
export const installWorkletScope = (sampleRate: number) => {
  const processors: Record<string, ProcessorClass> = {};
  Object.assign(globalThis, {
    sampleRate,
    AudioWorkletProcessor: class {
      port = { onmessage: null };
    },
    registerProcessor: (name: string, processor: ProcessorClass) => {
      processors[name] = processor;
    },
  });
  return processors;
};
