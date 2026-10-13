import { createSynthCore, stopModels } from '../../../../test-utils/models';
import { setVisibility } from '../../../../test-utils/visibility';

describe('synthCore', () => {
  it('connects preGain → fxIn → fxOut → limiter → masterGain → destination', () => {
    const [{ audioCtx, preGain, fxIn, fxOut, masterLimiter, masterGain }] = createSynthCore();
    expect(preGain.connect).toHaveBeenLastCalledWith(fxIn);
    expect(fxIn.connect).toHaveBeenCalledWith(fxOut);
    expect(fxOut.connect).toHaveBeenCalledWith(masterLimiter);
    expect(masterLimiter.connect).toHaveBeenCalledWith(masterGain);
    expect(masterGain.connect).toHaveBeenCalledWith(audioCtx.destination);
  });

  it('configures the limiter and the gains', () => {
    const [{ preGain, masterLimiter, masterGain }] = createSynthCore();
    expect(preGain.gain.value).toBe(1);
    expect(masterGain.gain.value).toBeCloseTo(0.8);
    expect(masterLimiter.threshold.setValueAtTime).toHaveBeenCalledWith(-16, 0);
    expect(masterLimiter.ratio.setValueAtTime).toHaveBeenCalledWith(20, 0);
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
