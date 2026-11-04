export interface WorkletProcessorStub {
  port: { onmessage: (event: { data: unknown }) => void; postMessage: jest.Mock };
  process: (
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters?: Record<string, Float32Array>
  ) => boolean;
}

type ProcessorClass = (new (options: AudioWorkletNodeOptions) => WorkletProcessorStub) & {
  parameterDescriptors?: unknown;
};

// the AudioWorkletGlobalScope a worklet module runs in; returns the processors it registers, by name
export const installWorkletScope = (sampleRate: number) => {
  const processors: Record<string, ProcessorClass> = {};
  Object.assign(globalThis, {
    sampleRate,
    // the frame of the block a processor renders (the specs set it)
    currentFrame: 0,
    AudioWorkletProcessor: class {
      port = { onmessage: null, postMessage: jest.fn() };
    },
    registerProcessor: (name: string, processor: ProcessorClass) => {
      processors[name] = processor;
    },
  });
  return processors;
};
