import { AudioContext as AudioContextMock } from 'standardized-audio-context-mock';

// a browser without AudioWorklet (old Safari) or a page that is not a secure context (http on a LAN IP):
// no audioContext.audioWorklet and no AudioWorkletNode. test-setup restores both after each test
export const withoutAudioWorklet = ({ secureContext = true } = {}) => {
  Object.defineProperty(AudioContextMock.prototype, 'audioWorklet', {
    configurable: true,
    get: () => undefined,
  });
  Object.assign(globalThis, { AudioWorkletNode: undefined });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => secureContext });
};
