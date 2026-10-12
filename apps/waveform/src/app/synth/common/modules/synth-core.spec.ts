import { createSynthCore, stopModels } from '../../../../test-utils/models';
import { setVisibility } from '../../../../test-utils/visibility';

describe('synthCore', () => {
  it('connects preGain → limiter → masterGain → destination', () => {
    const [{ audioCtx, preGain, masterLimiter, masterGain }] = createSynthCore();
    expect(preGain.connect).toHaveBeenLastCalledWith(masterLimiter);
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

  it('inserts mid nodes between preGain and limiter in order', () => {
    const [{ audioCtx, preGain, masterLimiter, $midNodes }, { addMidNode }] = createSynthCore();
    const first = audioCtx.createGain();
    const second = audioCtx.createGain();

    addMidNode(first);
    addMidNode(second);

    expect($midNodes.value).toEqual([first, second]);
    expect(preGain.disconnect).toHaveBeenCalled();
    expect(preGain.connect).toHaveBeenLastCalledWith(first);
    expect(first.connect).toHaveBeenLastCalledWith(second);
    expect(second.connect).toHaveBeenLastCalledWith(masterLimiter);
  });

  it('does not add the same mid node twice', () => {
    const [{ audioCtx, $midNodes }, { addMidNode }] = createSynthCore();
    const node = audioCtx.createGain();
    addMidNode(node);
    addMidNode(node);
    expect($midNodes.value).toEqual([node]);
  });

  it('removeMidNode disconnects the node and rewires the chain', () => {
    const [{ audioCtx, preGain, masterLimiter, $midNodes }, { addMidNode, removeMidNode }] =
      createSynthCore();
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
    expect(preGain.connect).toHaveBeenLastCalledWith(masterLimiter);
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
