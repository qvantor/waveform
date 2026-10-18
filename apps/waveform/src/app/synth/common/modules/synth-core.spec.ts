import { createSynthCore, stopModels } from '../../../../test-utils/models';
import { setVisibility } from '../../../../test-utils/visibility';
import { workletLoads } from '../../../../test-utils/worklet-loads';

describe('synthCore', () => {
  it('connects preGain → fxIn → fxOut → masterGain → limiter → destination', () => {
    const [{ audioCtx, preGain, fxIn, fxOut, masterLimiter, masterGain, output }] = createSynthCore();
    expect(preGain.connect).toHaveBeenLastCalledWith(fxIn);
    expect(fxIn.connect).toHaveBeenCalledWith(fxOut);
    expect(fxOut.connect).toHaveBeenCalledWith(masterGain);
    expect(masterGain.connect).toHaveBeenCalledWith(masterLimiter.input);
    // the analysers tap what is played
    expect(output).toBe(masterLimiter.output);
    expect(output.connect).toHaveBeenCalledWith(audioCtx.destination);
    // the limiter is the last stage, the master volume goes through it
    expect(fxOut.connect).not.toHaveBeenCalledWith(masterLimiter.input);
    expect(masterGain.connect).not.toHaveBeenCalledWith(audioCtx.destination);
    expect(masterGain.connect).toHaveBeenCalledTimes(1);
  });

  it('the master volume starts at 0 dB', () => {
    const [{ preGain, masterGain, $masterGain }] = createSynthCore();
    expect(preGain.gain.value).toBe(1);
    expect(masterGain.gain.value).toBe(1);
    expect($masterGain.value).toBe(1);
  });

  it('destroys the limiter and the wavetable oscillator when it stops', () => {
    const [{ masterLimiter, wavetables }] = createSynthCore();
    const destroy = jest.spyOn(masterLimiter, 'destroy');
    const destroyWavetables = jest.spyOn(wavetables, 'destroy');
    stopModels();
    expect(destroy).toHaveBeenCalled();
    expect(destroyWavetables).toHaveBeenCalled();
  });

  it('loads the wavetable oscillator at its start', () => {
    const [{ audioCtx, wavetables }] = createSynthCore();
    expect(workletLoads(audioCtx.audioWorklet.addModule as jest.Mock, 'wavetable-osc')).toBe(1);
    expect(wavetables.$status.value).toBe('loading');
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
