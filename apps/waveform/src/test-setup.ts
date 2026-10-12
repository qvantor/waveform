import { TextEncoder } from 'util';
import '@testing-library/jest-dom';
import {
  AudioContext as AudioContextMock,
  ChannelMergerNode as ChannelMergerNodeMock,
  PeriodicWave as PeriodicWaveMock,
  registrar,
  setMockingImplementation,
} from 'standardized-audio-context-mock';
import { stopModels } from './test-utils/model-registry';

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
  createPeriodicWave(real: Iterable<number>, imag: Iterable<number>) {
    return Object.assign(new PeriodicWaveMock(), { real: [...real], imag: [...imag] });
  },
});

Object.assign(globalThis, { AudioContext: AudioContextMock });

// jsdom has no TextEncoder, presetHash needs it
Object.assign(globalThis, { TextEncoder });

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
  stopModels();
  Reflect.deleteProperty(document, 'visibilityState');
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
