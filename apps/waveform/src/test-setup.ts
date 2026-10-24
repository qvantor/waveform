import { TextDecoder, TextEncoder } from 'util';
import '@testing-library/jest-dom';
import {
  AudioContext as AudioContextMock,
  AudioWorkletNode as AudioWorkletNodeMock,
  ChannelMergerNode as ChannelMergerNodeMock,
  ChannelSplitterNode as ChannelSplitterNodeMock,
  DelayNode as DelayNodeMock,
  PeriodicWave as PeriodicWaveMock,
  registrar,
  setMockingImplementation,
  WaveShaperNode as WaveShaperNodeMock,
} from 'standardized-audio-context-mock';
import { stopModels } from './test-utils/model-registry';
import { restoreStorage } from './test-utils/storage';
import { WorkerStub } from './test-utils/worker-stub';

// every node/param method of the mock becomes a jest.fn, so calls can be asserted
setMockingImplementation((implementation) => jest.fn(implementation));

// the mock returns empty objects for these, the synth needs real nodes and inspectable waves
Object.assign(AudioContextMock.prototype, {
  createChannelMerger(this: AudioContextMock, numberOfInputs = 6) {
    const node = new ChannelMergerNodeMock({
      context: this,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      numberOfInputs,
      numberOfOutputs: 1,
    } as never);
    registrar.addAudioNode(this, 'ChannelMergerNode' as never, node as never);
    return node;
  },
  createChannelSplitter(this: AudioContextMock, numberOfOutputs = 6) {
    const node = new ChannelSplitterNodeMock({
      context: this,
      channelCount: numberOfOutputs,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      numberOfInputs: 1,
      numberOfOutputs,
    } as never);
    registrar.addAudioNode(this, 'ChannelSplitterNode' as never, node as never);
    return node;
  },
  createDelay(this: AudioContextMock) {
    const node = new DelayNodeMock({
      context: this,
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
      numberOfInputs: 1,
      numberOfOutputs: 1,
    } as never);
    registrar.addAudioNode(this, 'DelayNode' as never, node as never);
    // the mock has no delayTime and doesn't export AudioParamMock, a gain param is the same mock
    return Object.assign(node, { delayTime: this.createGain().gain });
  },
  createWaveShaper(this: AudioContextMock) {
    const node = new WaveShaperNodeMock({
      context: this,
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
      numberOfInputs: 1,
      numberOfOutputs: 1,
    } as never);
    registrar.addAudioNode(this, 'WaveShaperNode' as never, node as never);
    return Object.assign(node, { curve: null, oversample: 'none' });
  },
  createPeriodicWave(real: Iterable<number>, imag: Iterable<number>) {
    return Object.assign(new PeriodicWaveMock(), { real: [...real], imag: [...imag] });
  },
});

// the mock's audioWorklet is an empty object: one addModule per context, resolved
// (withoutAudioWorklet removes it, restored after each test)
const worklets = new WeakMap<AudioContextMock, { addModule: jest.Mock }>();
const audioWorklet: PropertyDescriptor = {
  configurable: true,
  get(this: AudioContextMock) {
    const worklet = worklets.get(this) ?? { addModule: jest.fn(() => Promise.resolve()) };
    worklets.set(this, worklet);
    return worklet;
  },
};
Object.defineProperty(AudioContextMock.prototype, 'audioWorklet', audioWorklet);

// the mock's AudioWorkletNode takes the options of the other node mocks, not (context, name, options); no
// processor of the app has AudioParams
class AudioWorkletNodeStub extends AudioWorkletNodeMock<AudioContextMock> {
  port = { postMessage: jest.fn(), onmessage: null as ((event: MessageEvent) => void) | null };
  onprocessorerror: ((event: Event) => void) | null = null;
  readonly parameters = new Map<string, AudioParam>();

  constructor(context: AudioContextMock, readonly name: string, readonly options: AudioWorkletNodeOptions) {
    super({
      context,
      channelCount: options.channelCount ?? 2,
      channelCountMode: options.channelCountMode ?? 'max',
      channelInterpretation: options.channelInterpretation ?? 'speakers',
      numberOfInputs: options.numberOfInputs ?? 1,
      numberOfOutputs: options.numberOfOutputs ?? 1,
    } as never);
    registrar.addAudioNode(context, 'AudioWorkletNode' as never, this as never);
  }
}

Object.assign(globalThis, {
  AudioContext: AudioContextMock,
  AudioWorkletNode: AudioWorkletNodeStub,
  // no MessageChannel stub: React's scheduler would post its tasks to it (the specs pass one to the engine)
  Worker: WorkerStub,
});

// jsdom has no TextEncoder and TextDecoder: presetHash needs the encoder, the paths of the charts the decoder
Object.assign(globalThis, { TextEncoder, TextDecoder });

// antd uses matchMedia for responsive observers
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }),
});

// antd and the preset list use browser observers that jsdom doesn't have
class ObserverStub {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}
Object.assign(globalThis, { ResizeObserver: ObserverStub, IntersectionObserver: ObserverStub });

// jsdom has no crypto.randomUUID
let uuid = 0;
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  configurable: true,
  writable: true,
  value: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
});

afterEach(() => {
  restoreStorage();
  stopModels();
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(navigator, 'userAgentData');
  Reflect.deleteProperty(globalThis, 'AudioPlaybackStats');
  Reflect.deleteProperty(AudioContextMock.prototype, 'playbackStats');
  Object.defineProperty(AudioContextMock.prototype, 'audioWorklet', audioWorklet);
  Object.assign(globalThis, { AudioWorkletNode: AudioWorkletNodeStub, Worker: WorkerStub });
  WorkerStub.created = [];
  Reflect.deleteProperty(window, 'isSecureContext');
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});
