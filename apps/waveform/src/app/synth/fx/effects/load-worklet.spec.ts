import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { isWorkletSupported, loadWorklet, WORKLETS_PATH } from './load-worklet';

const addModuleOf = (audioCtx: AudioContext) => audioCtx.audioWorklet.addModule as jest.Mock;

describe('loadWorklet', () => {
  it('adds the module from the worklets path', async () => {
    const audioCtx = new AudioContext();
    await loadWorklet(audioCtx, 'reverb');
    expect(addModuleOf(audioCtx)).toHaveBeenCalledWith(
      new URL(`${WORKLETS_PATH}reverb.js`, document.baseURI).href
    );
  });

  it('adds every module once per context, the callers share the promise', async () => {
    const audioCtx = new AudioContext();
    const first = loadWorklet(audioCtx, 'reverb');
    expect(loadWorklet(audioCtx, 'reverb')).toBe(first);
    await first;
    expect(loadWorklet(audioCtx, 'reverb')).toBe(first);
    loadWorklet(audioCtx, 'chorus');
    expect(addModuleOf(audioCtx)).toHaveBeenCalledTimes(2);

    const other = new AudioContext();
    loadWorklet(other, 'reverb');
    expect(addModuleOf(other)).toHaveBeenCalledTimes(1);
  });

  it('rejects instead of throwing when the context has no audioWorklet', async () => {
    withoutAudioWorklet();
    const audioCtx = new AudioContext();
    let promise: Promise<void> | undefined;
    expect(() => (promise = loadWorklet(audioCtx, 'reverb'))).not.toThrow();
    await expect(promise).rejects.toThrow(TypeError);
  });

  it('forgets a failed load, so the next call adds the module again', async () => {
    const audioCtx = new AudioContext();
    addModuleOf(audioCtx).mockRejectedValueOnce(new Error('404'));
    const failed = loadWorklet(audioCtx, 'reverb');
    await expect(failed).rejects.toThrow('404');

    const retry = loadWorklet(audioCtx, 'reverb');
    expect(retry).not.toBe(failed);
    expect(addModuleOf(audioCtx)).toHaveBeenCalledTimes(2);
    await expect(retry).resolves.toBeUndefined();
    expect(loadWorklet(audioCtx, 'reverb')).toBe(retry);
  });

  it('a caller that retries on the rejection already gets a new load', async () => {
    const audioCtx = new AudioContext();
    addModuleOf(audioCtx).mockRejectedValueOnce(new Error('404'));
    const failed = loadWorklet(audioCtx, 'reverb');
    let retry: Promise<void> | undefined;
    await failed.catch(() => (retry = loadWorklet(audioCtx, 'reverb')));
    expect(retry).toBeInstanceOf(Promise);
    expect(retry).not.toBe(failed);
    expect(addModuleOf(audioCtx)).toHaveBeenCalledTimes(2);
  });
});

describe('isWorkletSupported', () => {
  it('is true with audioWorklet and AudioWorkletNode', () => {
    expect(isWorkletSupported(new AudioContext())).toBe(true);
  });

  it('is false in old browsers and outside secure contexts', () => {
    withoutAudioWorklet();
    expect(isWorkletSupported(new AudioContext())).toBe(false);
  });
});
