import { config } from 'rxjs';
import { registrar } from 'standardized-audio-context-mock';
import { applySnapshot, getSnapshot } from '../../../app';
import { createSynth, stopModels } from '../../../../test-utils/models';
import { getFq } from '../../services';

const setup = () => {
  const modules = createSynth();
  const [{ audioCtx, preGain }] = modules.synthCore;
  const createGain = jest.spyOn(audioCtx, 'createGain');
  const [, { onPress, onRelease }] = modules.inputController;
  const [synthModel, synthActions] = modules.synth;

  const oscillators = () =>
    registrar.getAudioNodes(audioCtx as never, 'OscillatorNode') as unknown as OscillatorNode[];
  const gains = () => createGain.mock.results.map(({ value }) => value as GainNode);
  // ADSR envelopes are the gains connected straight to the synth output
  const envelopes = () =>
    gains().filter((gain) => (gain.connect as jest.Mock).mock.calls.some(([node]) => node === preGain));
  const travel = (seconds: number) => registrar.getDeLorean(audioCtx as never)?.travel(seconds);

  return {
    ...modules,
    audioCtx,
    onPress,
    onRelease,
    synthModel,
    synthActions,
    oscillators,
    gains,
    envelopes,
    travel,
  };
};

const lastValue = (param: AudioParam) => (param.setValueAtTime as jest.Mock).mock.calls.at(-1)?.[0];

describe('synth', () => {
  it('plays a note with unison oscillators of every active oscillator', () => {
    const { onPress, oscillators, synthModel } = setup();

    onPress([4, 'A']);

    // osc1 is active with unison 2, osc2 is inactive
    expect(oscillators()).toHaveLength(2);
    oscillators().forEach((oscillator) => {
      expect(lastValue(oscillator.frequency)).toBeCloseTo(440);
      expect(oscillator.start).toHaveBeenCalledWith(0);
    });
    expect(synthModel.$voicesCount.value).toBe(1);
  });

  it('spreads the unison oscillators over the detune range', () => {
    const { onPress, oscillators, osc1 } = setup();
    osc1[1].setOscValue('unison', 3);
    osc1[1].setOscValue('detune', 20);

    onPress([4, 'C']);

    expect(oscillators().map((oscillator) => lastValue(oscillator.detune))).toEqual([-10, 0, 10]);
  });

  it('does not detune a single oscillator and connects it directly', () => {
    const { onPress, oscillators, osc1, gains } = setup();
    osc1[1].setOscValue('unison', 1);

    onPress([4, 'C']);

    const [oscillator] = oscillators();
    expect(oscillator.detune.setValueAtTime).not.toHaveBeenCalled();
    expect(gains()).toContain((oscillator.connect as jest.Mock).mock.calls[0][0]);
  });

  it('pairs unison oscillators into the stereo channels', () => {
    const { onPress, oscillators, audioCtx } = setup();
    onPress([4, 'C']);

    const [merger] = registrar.getAudioNodes(audioCtx as never, 'ChannelMergerNode' as never);
    const [left, right] = oscillators();
    expect(left.connect).toHaveBeenCalledWith(merger, 0, 0);
    expect(right.connect).toHaveBeenCalledWith(merger, 0, 1);
  });

  it('uses both oscillators with their octave and gain when both are active', () => {
    const { onPress, oscillators, osc2, gains } = setup();
    osc2[1].toggleActive();
    osc2[1].setOscValue('octave', -1);
    osc2[1].setGain(0.3);

    onPress([4, 'A']);

    const frequencies = oscillators().map((oscillator) => lastValue(oscillator.frequency));
    expect(frequencies).toEqual([440, 440, 220, 220].map(expect.closeTo));
    expect(gains().map((gain) => lastValue(gain.gain))).toEqual(expect.arrayContaining([0.5, 0.3]));
  });

  it('shapes a note with the ADSR envelope', async () => {
    const { onPress, envelopes, adsrEnvelope, travel } = setup();
    const [, { setEnvelopeValue }] = adsrEnvelope;
    setEnvelopeValue('attack', 0.1);
    setEnvelopeValue('hold', 0.1);
    setEnvelopeValue('decay', 0.1);
    setEnvelopeValue('sustain', 0.5);

    onPress([4, 'C']);
    const [envelope] = envelopes();

    expect(envelope.gain.value).toBe(0);
    await travel(0.05);
    expect(envelope.gain.value).toBeCloseTo(0.5);
    // hold
    await travel(0.1);
    expect(envelope.gain.value).toBeCloseTo(1);
    // decay to sustain
    await travel(0.1);
    expect(envelope.gain.value).toBeCloseTo(0.75);
    await travel(1);
    expect(envelope.gain.value).toBeCloseTo(0.5);
  });

  it('releases a note with the envelope release time', async () => {
    const { onPress, onRelease, oscillators, envelopes, synthModel, adsrEnvelope, travel } = setup();
    adsrEnvelope[1].setEnvelopeValue('release', 0.5);
    onPress([4, 'C']);
    await travel(1);

    onRelease([4, 'C']);

    oscillators().forEach((oscillator) => expect(oscillator.stop).toHaveBeenCalledWith(1.5));
    const [envelope] = envelopes();
    expect(envelope.gain.cancelScheduledValues).toHaveBeenCalledWith(1);
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.001, 1.5);
    expect(synthModel.$voicesCount.value).toBe(0);
  });

  it('disconnects oscillators when they end', () => {
    const { onPress, onRelease, oscillators } = setup();
    onPress([4, 'C']);
    onRelease([4, 'C']);

    const [oscillator] = oscillators();
    oscillator.dispatchEvent(new Event('ended'));

    expect(oscillator.disconnect).toHaveBeenCalled();
  });

  it('plays several notes and steals the oldest voice above max voices', async () => {
    const { onPress, oscillators, synthModel, synthActions, travel } = setup();
    synthActions.setMaxVoices(2);

    onPress([4, 'C']);
    onPress([4, 'E']);
    expect(synthModel.$voicesCount.value).toBe(2);

    await travel(2);
    onPress([4, 'G']);

    expect(synthModel.$voicesCount.value).toBe(2);
    const [c1, c2, e1, e2] = oscillators();
    // the oldest one is stopped immediately
    expect(c1.stop).toHaveBeenCalledWith(2);
    expect(c2.stop).toHaveBeenCalledWith(2);
    expect(e1.stop).not.toHaveBeenCalled();
    expect(e2.stop).not.toHaveBeenCalled();
  });

  it('glides from the previous held note with portamento', async () => {
    const { onPress, oscillators, synthActions, travel } = setup();
    synthActions.setPortamento(200);

    onPress([4, 'C']);
    await travel(1);
    onPress([4, 'E']);

    const [, , glide] = oscillators();
    expect(glide.frequency.setValueAtTime).toHaveBeenCalledWith(getFq([4, 'C']), 1);
    expect(glide.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(getFq([4, 'E']), 1.2);
  });

  it('does not glide when no note is held', () => {
    const { onPress, onRelease, oscillators, synthActions } = setup();
    synthActions.setPortamento(200);

    onPress([4, 'C']);
    onRelease([4, 'C']);
    onPress([4, 'E']);

    const [, , next] = oscillators();
    expect(next.frequency.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(lastValue(next.frequency)).toBeCloseTo(getFq([4, 'E']));
  });

  it('shares one envelope between overlapping notes in legato mode', () => {
    const { onPress, onRelease, envelopes, synthActions } = setup();
    synthActions.setLegato(true);

    onPress([4, 'C']);
    onPress([4, 'E']);
    expect(envelopes()).toHaveLength(1);
    const [envelope] = envelopes();

    onRelease([4, 'C']);
    expect(envelope.gain.cancelScheduledValues).not.toHaveBeenCalled();

    onRelease([4, 'E']);
    expect(envelope.gain.cancelScheduledValues).toHaveBeenCalled();

    // the next note starts a new envelope
    onPress([4, 'G']);
    expect(envelopes()).toHaveLength(2);
  });

  it('applies oscillator gain changes to playing voices', () => {
    const { onPress, osc1, gains } = setup();
    onPress([4, 'C']);
    const oscGain = gains().find((gain) => lastValue(gain.gain) === 0.5) as GainNode;

    osc1[1].setGain(0.1);

    expect(lastValue(oscGain.gain)).toBe(0.1);
  });

  it('applies wavetable changes to playing voices', () => {
    const { onPress, osc1, oscillators } = setup();
    onPress([4, 'C']);

    osc1[1].setWaveTable([[1, 0, -1, 0]]);

    const wave = osc1[0].$periodicWave.value;
    oscillators().forEach((oscillator) => expect(oscillator.setPeriodicWave).toHaveBeenLastCalledWith(wave));
  });

  it('ignores wave changes of an oscillator that is not part of a playing voice', async () => {
    const { onPress, osc2, oscillators } = setup();
    // rxjs reports errors thrown in subscribers asynchronously instead of rethrowing them
    const onUnhandledError = jest.fn();
    config.onUnhandledError = onUnhandledError;
    onPress([4, 'C']);

    osc2[1].setWaveTable([[1, 0, -1, 0]]);
    await new Promise((resolve) => setTimeout(resolve));
    config.onUnhandledError = null;

    expect(onUnhandledError).not.toHaveBeenCalled();

    const wave = osc2[0].$periodicWave.value;
    oscillators().forEach((oscillator) => expect(oscillator.setPeriodicWave).not.toHaveBeenCalledWith(wave));
  });

  it('stops listening to the input after stop', () => {
    const { onPress, oscillators } = setup();
    stopModels();
    onPress([4, 'C']);
    expect(oscillators()).toHaveLength(0);
  });

  describe('snapshot', () => {
    it('exposes voicing settings under "v"', () => {
      const { synthActions } = setup();
      synthActions.setLegato(true);
      synthActions.setPortamento(120);
      synthActions.setMaxVoices(4);
      expect(getSnapshot()['v']).toEqual({ leg: true, port: 120, max: 4 });
    });

    it('applies falsy values and keeps settings missing in the snapshot', () => {
      const { synthModel, synthActions } = setup();
      synthActions.setLegato(true);
      synthActions.setPortamento(120);
      synthActions.setMaxVoices(4);

      applySnapshot({ v: { leg: false, port: 0 } });

      expect(synthModel.$legato.value).toBe(false);
      expect(synthModel.$portamento.value).toBe(0);
      expect(synthModel.$maxVoices.value).toBe(4);
    });
  });
});
