import { createSynthCore, stopModels } from '../../../../test-utils/models';
import { setVisibility } from '../../../../test-utils/visibility';
import { LIMITER, limiterMakeupGain } from './synth-core';

const db = (gain: number) => 20 * Math.log10(gain);
// the hard knee curve of a DynamicsCompressorNode, dB in → dB out
const curve = (input: number, threshold: number, ratio: number) =>
  input < threshold ? input : threshold + (input - threshold) / ratio;
// the static level (dB) the limiter outputs: its curve plus the makeup gain it adds
const limited = (input: number) =>
  curve(input, LIMITER.threshold, LIMITER.ratio) + db(limiterMakeupGain(LIMITER));

describe('synthCore', () => {
  it('connects preGain → fxIn → fxOut → masterGain → limiter → output → destination', () => {
    const [{ audioCtx, preGain, fxIn, fxOut, masterLimiter, masterGain, output }] = createSynthCore();
    expect(preGain.connect).toHaveBeenLastCalledWith(fxIn);
    expect(fxIn.connect).toHaveBeenCalledWith(fxOut);
    expect(fxOut.connect).toHaveBeenCalledWith(masterGain);
    expect(masterGain.connect).toHaveBeenCalledWith(masterLimiter);
    expect(masterLimiter.connect).toHaveBeenCalledWith(output);
    expect(output.connect).toHaveBeenCalledWith(audioCtx.destination);
    // the limiter is the last stage, the master volume goes through it
    expect(fxOut.connect).not.toHaveBeenCalledWith(masterLimiter);
    expect(masterGain.connect).not.toHaveBeenCalledWith(audioCtx.destination);
    expect(masterLimiter.connect).toHaveBeenCalledTimes(1);
  });

  it('configures the limiter as a hard knee with a release that does not follow the wave', () => {
    const [{ preGain, masterLimiter, masterGain }] = createSynthCore();
    expect(preGain.gain.value).toBe(1);
    expect(masterGain.gain.value).toBe(1);
    expect(masterLimiter.threshold.setValueAtTime).toHaveBeenCalledWith(-4, 0);
    expect(masterLimiter.knee.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(masterLimiter.ratio.setValueAtTime).toHaveBeenCalledWith(20, 0);
    expect(masterLimiter.attack.setValueAtTime).toHaveBeenCalledWith(0.001, 0);
    expect(masterLimiter.release.setValueAtTime).toHaveBeenCalledWith(0.25, 0);
    expect(masterLimiter.threshold.value).toBe(LIMITER.threshold);
    expect(masterLimiter.knee.value).toBe(LIMITER.knee);
    expect(masterLimiter.release.value).toBe(LIMITER.release);
  });

  describe('limiter levels', () => {
    it('takes back the makeup gain of the limiter in output (-2.28 dB)', () => {
      const [{ output }] = createSynthCore();
      expect(output.gain.value).toBeCloseTo(0.7691, 4);
    });

    it('passes the sound below the threshold at unity', () => {
      const [{ output }] = createSynthCore();
      [-40, -12, -4.5].forEach((input) =>
        expect(limited(input) + db(output.gain.value)).toBeCloseTo(input, 6)
      );
    });

    // the room for the overshoot of the compressor on dense unison chords struck at once
    // (in Chrome ~2.5 dB at a 5 ms attack, ~4 dB at attack 0)
    it('keeps a sound 20 dB over full scale 2.8 dB below 0 dBFS', () => {
      const [{ output }] = createSynthCore();
      expect(limited(20) + db(output.gain.value)).toBeCloseTo(-2.8, 6);
      // without taking back the makeup gain it would be 2.3 dB louder, the overshoot would clip
      expect(limited(20)).toBeGreaterThan(-1);
    });
  });

  describe('limiterMakeupGain', () => {
    it('is +3.42 dB for a threshold of -6 dB at ratio 20', () => {
      expect(db(limiterMakeupGain({ threshold: -6, ratio: 20 }))).toBeCloseTo(3.42, 2);
    });

    it('is unity for a threshold of 0 dB or a ratio of 1', () => {
      expect(limiterMakeupGain({ threshold: 0, ratio: 20 })).toBe(1);
      expect(limiterMakeupGain({ threshold: -12, ratio: 1 })).toBe(1);
    });

    // the spec: makeup = (1 / curve(1.0))^0.6
    it('is the inverse of the curve at full scale to the power 0.6', () => {
      [
        [-6, 20],
        [-3, 12],
        [-24, 4],
      ].forEach(([threshold, ratio]) => {
        expect(db(limiterMakeupGain({ threshold, ratio }))).toBeCloseTo(
          -0.6 * curve(0, threshold, ratio),
          10
        );
      });
    });
  });

  it('setMasterGain updates the master gain', () => {
    const [{ masterGain }, { setMasterGain }] = createSynthCore();
    setMasterGain(0.3);
    expect(masterGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.3, 0);
    expect(masterGain.gain.value).toBeCloseTo(0.3);
  });

  it('inserts mid nodes between preGain and fxIn in order', () => {
    const [{ audioCtx, preGain, fxIn, $midNodes }, { addMidNode }] = createSynthCore();
    const first = audioCtx.createGain();
    const second = audioCtx.createGain();

    addMidNode(first);
    addMidNode(second);

    expect($midNodes.value).toEqual([first, second]);
    expect(preGain.disconnect).toHaveBeenCalled();
    expect(preGain.connect).toHaveBeenLastCalledWith(first);
    expect(first.connect).toHaveBeenLastCalledWith(second);
    expect(second.connect).toHaveBeenLastCalledWith(fxIn);
  });

  it('drops the old links of the kept mid nodes on rewiring', () => {
    const [{ audioCtx, fxIn }, { addMidNode }] = createSynthCore();
    const first = audioCtx.createGain();
    const second = audioCtx.createGain();

    addMidNode(first);
    expect(first.connect).toHaveBeenLastCalledWith(fxIn);
    addMidNode(second);

    // first → fxIn is cut before first → second is made
    const connectOrder = (first.connect as jest.Mock).mock.invocationCallOrder;
    const [disconnectOrder] = (first.disconnect as jest.Mock).mock.invocationCallOrder;
    expect(disconnectOrder).toBeGreaterThan(connectOrder[0]);
    expect(disconnectOrder).toBeLessThan(connectOrder[1]);
    expect(first.connect).toHaveBeenLastCalledWith(second);
  });

  it('does not add the same mid node twice', () => {
    const [{ audioCtx, $midNodes }, { addMidNode }] = createSynthCore();
    const node = audioCtx.createGain();
    addMidNode(node);
    addMidNode(node);
    expect($midNodes.value).toEqual([node]);
  });

  it('removeMidNode disconnects the node and rewires the chain', () => {
    const [{ audioCtx, preGain, fxIn, $midNodes }, { addMidNode, removeMidNode }] = createSynthCore();
    const first = audioCtx.createGain();
    const second = audioCtx.createGain();
    addMidNode(first);
    addMidNode(second);

    removeMidNode(first);
    expect(first.disconnect).toHaveBeenCalled();
    expect($midNodes.value).toEqual([second]);
    expect(preGain.connect).toHaveBeenLastCalledWith(second);

    removeMidNode(second);
    expect($midNodes.value).toEqual([]);
    expect(preGain.connect).toHaveBeenLastCalledWith(fxIn);
  });

  it.each(['pointerdown', 'touchend', 'keydown', 'visibilitychange'])(
    'resumes a suspended context on %s',
    (type) => {
      const [{ audioCtx }] = createSynthCore();
      const resume = jest.spyOn(audioCtx, 'resume');
      expect(audioCtx.state).toBe('suspended');

      document.dispatchEvent(new Event(type));

      expect(resume).toHaveBeenCalledTimes(1);
      expect(audioCtx.state).toBe('running');
    }
  );

  it('does not resume a running context or a hidden page', () => {
    const [{ audioCtx }] = createSynthCore();
    const resume = jest.spyOn(audioCtx, 'resume');

    setVisibility('hidden');
    document.dispatchEvent(new Event('pointerdown'));
    expect(resume).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerdown'));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('switches the iOS audio session to playback before resuming', () => {
    const audioSession = { type: 'auto' };
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: audioSession });
    createSynthCore();
    document.dispatchEvent(new Event('pointerdown'));
    expect(audioSession.type).toBe('playback');
    delete (navigator as { audioSession?: unknown }).audioSession;
  });

  it('stops listening to gestures after stop', () => {
    const [{ audioCtx }] = createSynthCore();
    const resume = jest.spyOn(audioCtx, 'resume');
    stopModels();
    document.dispatchEvent(new Event('pointerdown'));
    expect(resume).not.toHaveBeenCalled();
  });
});
