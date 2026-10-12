import { applySnapshot, getSnapshot } from '../../../app';
import { createOscillator, createSynthCore } from '../../../../test-utils/models';

type WaveMock = PeriodicWave & { real: number[]; imag: number[] };
const real = (wave: PeriodicWave) => (wave as WaveMock).real;

const saw = [-1, -0.5, 0, 0.5];
const square = [1, 1, -1, -1];

describe('oscillator', () => {
  it('starts with the initial state', () => {
    const [model] = createOscillator(undefined, 'osc1', {
      active: false,
      initialWavePath: ['folder', 'file.wav'],
    });
    expect(model.$active.value).toBe(false);
    expect(model.$waveTablePath.value).toEqual(['folder', 'file.wav']);
    expect(model.$osc.value).toEqual({ unison: 2, detune: 5, randPhase: 0, octave: 0 });
    expect(real(model.$periodicWave.value)).toEqual([0, 1]);
  });

  it('builds the periodic wave from the current wave of the table', () => {
    const synthCore = createSynthCore();
    const createPeriodicWave = jest.spyOn(synthCore[0].audioCtx, 'createPeriodicWave');
    const [{ $periodicWave }, { setWaveTable, setCurrent }] = createOscillator(synthCore);

    setWaveTable([saw, square]);
    expect(real($periodicWave.value)).toEqual(saw);
    // createPeriodicWave needs real and imag of the same length
    expect((createPeriodicWave.mock.calls.at(-1)?.[1] as number[]).length).toBe(saw.length);

    setCurrent(1);
    expect(real($periodicWave.value)).toEqual(square);
  });

  it('rebuilds the periodic wave when the current wave is edited', () => {
    const [{ $periodicWave, $waveTable }, { setWaveTable }] = createOscillator();
    setWaveTable([saw]);

    $waveTable.value[0].next(square);

    expect(real($periodicWave.value)).toEqual(square);
  });

  it('clamps the current wave index when a shorter table is set', () => {
    const [{ $current, $periodicWave }, { setWaveTable, setCurrent }] = createOscillator();
    setWaveTable([saw, square, saw]);
    setCurrent(2);

    setWaveTable([square, saw]);

    expect($current.value).toBe(1);
    expect(real($periodicWave.value)).toEqual(saw);
  });

  it('falls back to a default wave when the index is out of the table', () => {
    const [{ $periodicWave }, { setWaveTable, setCurrent }] = createOscillator();
    setWaveTable([saw]);
    setCurrent(5);
    expect(real($periodicWave.value)).toEqual([0, 1]);
  });

  it('applies the gain to the gain node', () => {
    const [{ gainNode }, { setGain }] = createOscillator();
    expect(gainNode.gain.value).toBe(0.5);
    setGain(0.2);
    expect(gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(0.2, 0);
    expect(gainNode.gain.value).toBeCloseTo(0.2);
  });

  it('updates settings through actions', () => {
    const [model, actions] = createOscillator();
    actions.setOscValue('unison', 5);
    actions.toggleActive();
    actions.setWaveTablePath(['a', 'b']);
    expect(model.$osc.value.unison).toBe(5);
    expect(model.$active.value).toBe(false);
    expect(model.$waveTablePath.value).toEqual(['a', 'b']);
  });

  it('gives every oscillator its own id', () => {
    const synthCore = createSynthCore();
    const [first] = createOscillator(synthCore, 'osc1');
    const [second] = createOscillator(synthCore, 'osc2');
    expect(first.id).not.toBe(second.id);
  });

  describe('snapshot', () => {
    it('exposes the persisted state', () => {
      const [, actions] = createOscillator();
      actions.setOscValue('octave', -2);
      actions.setGain(0.7);
      actions.setCurrent(3);
      actions.setWaveTablePath(['a', 1]);

      expect(getSnapshot()['osc1']).toEqual({
        a: true,
        p: ['a', '1'],
        w: 3,
        o: -2,
        d: 5,
        u: 2,
        r: 0,
        g: 0.7,
      });
    });

    it('applies falsy values', () => {
      const [model] = createOscillator();
      model.$current.next(2);
      applySnapshot({ osc1: { a: false, w: 0, g: 0, o: 0, d: 0, u: 1, r: 0 } });

      expect(model.$active.value).toBe(false);
      expect(model.$current.value).toBe(0);
      expect(model.$gain.value).toBe(0);
      expect(model.$osc.value).toEqual({ octave: 0, detune: 0, unison: 1, randPhase: 0 });
    });

    it('restores default settings for missing keys and keeps the wavetable', () => {
      const [model, actions] = createOscillator();
      actions.setOscValue('detune', 50);
      actions.setGain(0.9);

      applySnapshot({});

      expect(model.$osc.value).toEqual({ octave: 0, detune: 5, unison: 2, randPhase: 0 });
      expect(model.$gain.value).toBe(0.9);
      expect(model.$waveTablePath.value).toEqual(['default']);
    });
  });
});
