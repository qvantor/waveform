import { registrar } from 'standardized-audio-context-mock';
import { applySnapshot, getSnapshot } from '../../../app';
import { createSynth, stopModels } from '../../../../test-utils/models';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { WorkerStub } from '../../../../test-utils/worker-stub';
import { getFq } from '../../services';
import { VOICE_PROCESSOR } from '../wavetable/wavetable-osc-params';

interface VoiceNode extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
  port: AudioWorkletNode['port'] & { onmessage: ((event: { data: unknown }) => void) | null };
}

// the wavetable oscillator loads its module asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));

const setup = async ({ ready = true } = {}) => {
  const modules = createSynth();
  const [{ audioCtx, preGain, wavetables }] = modules.synthCore;
  const createGain = jest.spyOn(audioCtx, 'createGain');
  const [, { onPress, onRelease }] = modules.inputController;
  const [synthModel, synthActions] = modules.synth;
  if (ready) await flush();

  const voices = () =>
    (
      registrar.getAudioNodes(audioCtx as never, 'AudioWorkletNode' as never) as unknown as VoiceNode[]
    ).filter(({ name }) => name === VOICE_PROCESSOR);
  const param = (voice: VoiceNode, name: string) => voice.parameters.get(name) as AudioParam;
  const gains = () => createGain.mock.results.map(({ value }) => value as GainNode);
  // ADSR envelopes are the gains connected straight to the synth output
  const envelopes = () =>
    gains().filter((gain) => (gain.connect as jest.Mock).mock.calls.some(([node]) => node === preGain));
  // the processor of a voice tells its node it has ended
  const end = (voice: VoiceNode) => voice.port.onmessage?.({ data: { ended: true } });
  const travel = (seconds: number) => registrar.getDeLorean(audioCtx as never)?.travel(seconds);

  return {
    ...modules,
    audioCtx,
    wavetables,
    onPress,
    onRelease,
    synthModel,
    synthActions,
    voices,
    param,
    gains,
    envelopes,
    end,
    travel,
  };
};

const calls = (param: AudioParam, method: 'setValueAtTime' | 'setTargetAtTime' | 'linearRampToValueAtTime') =>
  (param[method] as jest.Mock).mock.calls;

describe('synth', () => {
  it('plays a note with one node for both oscillators, their unison and gain inside', async () => {
    const { onPress, voices, synthModel, osc1, param } = await setup();

    onPress([4, 'A']);

    const [voice] = voices();
    expect(voices()).toHaveLength(1);
    // osc1 is active with unison 2, osc2 is inactive
    expect(voice.options.processorOptions).toEqual({
      osc: [{ table: osc1[0].id, unison: 2, phase: 0.5, phaseRand: 1 }, null],
      start: 0,
    });
    expect(param(voice, 'frequency').value).toBeCloseTo(440);
    expect(param(voice, 'gain1').value).toBe(0.5);
    expect(param(voice, 'spread1').value).toBe(5);
    expect(param(voice, 'detune1').value).toBe(0);
    expect(param(voice, 'position1').value).toBe(0);
    expect(param(voice, 'gate').value).toBe(1);
    expect(synthModel.$voicesCount.value).toBe(1);
  });

  it('uses both oscillators with their octave, gain and position when both are active', async () => {
    const { onPress, voices, osc1, osc2, param } = await setup();
    osc2[1].toggleActive();
    osc2[1].setOscValue('octave', -1);
    osc2[1].setOscValue('unison', 4);
    osc2[1].setGain(0.3);
    osc2[1].setWaveTable([
      [0, 1, 0, -1],
      [1, 0, -1, 0],
      [0, -1, 0, 1],
    ]);
    osc2[1].setPosition(1);

    onPress([4, 'A']);

    const [voice] = voices();
    expect((voice.options.processorOptions as { osc: unknown[] }).osc).toEqual([
      { table: osc1[0].id, unison: 2, phase: 0.5, phaseRand: 1 },
      { table: osc2[0].id, unison: 4, phase: 0.5, phaseRand: 1 },
    ]);
    // the octave in cents, the position as a share of the table
    expect(param(voice, 'detune2').value).toBe(-1200);
    expect(param(voice, 'gain2').value).toBe(0.3);
    expect(param(voice, 'position2').value).toBe(0.5);
  });

  it('creates no native oscillators and no gains per oscillator', async () => {
    const { onPress, audioCtx, gains, envelopes } = await setup();
    onPress([4, 'A']);
    expect(registrar.getAudioNodes(audioCtx as never, 'OscillatorNode')).toHaveLength(0);
    expect(gains()).toEqual(envelopes());
  });

  it('connects the node of a voice to its envelope', async () => {
    const { onPress, voices, envelopes } = await setup();
    onPress([4, 'A']);
    const [voice] = voices();
    const [envelope] = envelopes();
    expect(voice.connect).toHaveBeenCalledWith(envelope);
  });

  it('shapes a note with the ADSR envelope', async () => {
    const { onPress, envelopes, adsrEnvelope, travel } = await setup();
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

  it('releases a note with the envelope release time: its gate closes at the end of it', async () => {
    const { onPress, onRelease, voices, param, envelopes, synthModel, adsrEnvelope, travel } = await setup();
    adsrEnvelope[1].setEnvelopeValue('release', 0.5);
    onPress([4, 'C']);
    await travel(1);

    onRelease([4, 'C']);

    const [voice] = voices();
    expect(calls(param(voice, 'gate'), 'setValueAtTime').at(-1)).toEqual([0, 1.5]);
    const [envelope] = envelopes();
    expect(envelope.gain.cancelScheduledValues).toHaveBeenCalledWith(1);
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.001, 1.5);
    expect(synthModel.$voicesCount.value).toBe(0);
  });

  it('takes the node and the envelope of a voice off once it has ended', async () => {
    const { onPress, onRelease, voices, envelopes, end } = await setup();
    onPress([4, 'C']);
    onRelease([4, 'C']);
    const [voice] = voices();
    const [envelope] = envelopes();
    expect(voice.disconnect).not.toHaveBeenCalled();

    end(voice);

    expect(voice.disconnect).toHaveBeenCalled();
    expect(envelope.disconnect).toHaveBeenCalled();
  });

  it('takes a held voice off when its processor fails, the others and new notes play on', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { onPress, onRelease, voices, envelopes, wavetables, osc1, audioCtx } = await setup();
    osc1[1].connectBus('gain', audioCtx.createOscillator());
    onPress([4, 'C']);
    onPress([4, 'E']);
    const [c, e] = voices();
    const [cEnvelope, eEnvelope] = envelopes();

    c.onprocessorerror?.(new Event('processorerror'));

    expect(error).toHaveBeenCalledWith('A voice of the wavetable oscillator failed', expect.any(Event));
    expect(c.disconnect).toHaveBeenCalled();
    expect(cEnvelope.disconnect).toHaveBeenCalled();
    expect(osc1[0].buses.gain.disconnect).toHaveBeenCalledTimes(1);
    expect(e.disconnect).not.toHaveBeenCalled();
    expect(eEnvelope.disconnect).not.toHaveBeenCalled();
    expect(wavetables.$status.value).toBe('ready');
    // a voice that ended doesn't follow the knobs, its note is released as any other
    osc1[1].connectBus('spread', audioCtx.createOscillator());
    expect(osc1[0].buses.spread.connect).toHaveBeenCalledTimes(1);
    onRelease([4, 'C']);
    onPress([4, 'G']);
    expect(voices()).toHaveLength(3);
    error.mockRestore();
  });

  it('steals the oldest voice above max voices: it fades out in its processor', async () => {
    const { onPress, voices, param, synthModel, synthActions, travel } = await setup();
    synthActions.setMaxVoices(2);

    onPress([4, 'C']);
    onPress([4, 'E']);
    expect(synthModel.$voicesCount.value).toBe(2);

    await travel(2);
    onPress([4, 'G']);

    expect(synthModel.$voicesCount.value).toBe(2);
    const [c, e, g] = voices();
    expect(calls(param(c, 'gate'), 'setValueAtTime').at(-1)).toEqual([-1, 2]);
    expect(calls(param(e, 'gate'), 'setValueAtTime')).toEqual([]);
    expect(calls(param(g, 'gate'), 'setValueAtTime')).toEqual([]);
  });

  it('takes a stolen voice off once its node has ended', async () => {
    const { onPress, voices, envelopes, end, synthActions } = await setup();
    synthActions.setMaxVoices(1);
    onPress([4, 'C']);
    onPress([4, 'E']);
    const [first] = envelopes();

    end(voices()[0]);

    expect(first.disconnect).toHaveBeenCalled();
    expect(envelopes()[1].disconnect).not.toHaveBeenCalled();
  });

  it('glides from the previous held note with portamento', async () => {
    const { onPress, voices, param, synthActions, travel } = await setup();
    synthActions.setPortamento(200);

    onPress([4, 'C']);
    await travel(1);
    onPress([4, 'E']);

    const [, glide] = voices();
    expect(param(glide, 'frequency').value).toBeCloseTo(getFq([4, 'C']));
    expect(calls(param(glide, 'frequency'), 'setValueAtTime')).toEqual([[getFq([4, 'C']), 1]]);
    expect(calls(param(glide, 'frequency'), 'linearRampToValueAtTime')).toEqual([[getFq([4, 'E']), 1.2]]);
  });

  it('does not glide when no note is held', async () => {
    const { onPress, onRelease, voices, param, synthActions } = await setup();
    synthActions.setPortamento(200);

    onPress([4, 'C']);
    onRelease([4, 'C']);
    onPress([4, 'E']);

    const [, next] = voices();
    expect(calls(param(next, 'frequency'), 'linearRampToValueAtTime')).toEqual([]);
    expect(param(next, 'frequency').value).toBeCloseTo(getFq([4, 'E']));
  });

  it('shares one envelope between overlapping notes in legato mode', async () => {
    const { onPress, onRelease, envelopes, synthActions } = await setup();
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

  it('keeps a held legato note when the note it stole is released', async () => {
    const { onPress, onRelease, envelopes, synthActions, synthModel } = await setup();
    synthActions.setLegato(true);
    synthActions.setMaxVoices(1);
    onPress([4, 'A']);
    onPress([4, 'B']);
    const [envelope] = envelopes();

    onRelease([4, 'A']);
    expect(envelope.gain.cancelScheduledValues).not.toHaveBeenCalled();
    expect(synthModel.$voicesCount.value).toBe(1);

    onRelease([4, 'B']);
    expect(envelope.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(synthModel.$voicesCount.value).toBe(0);
  });

  it('takes the legato envelope off once it is released and its last voice has ended', async () => {
    const { onPress, onRelease, voices, envelopes, end, synthActions } = await setup();
    synthActions.setLegato(true);
    onPress([4, 'C']);
    onPress([4, 'E']);
    const [envelope] = envelopes();
    const [c, e] = voices();

    onRelease([4, 'C']);
    end(c);
    expect(envelope.disconnect).not.toHaveBeenCalled();

    onRelease([4, 'E']);
    expect(envelope.disconnect).not.toHaveBeenCalled();
    end(e);
    expect(envelope.disconnect).toHaveBeenCalled();
  });

  describe('playing notes follow the knobs', () => {
    it('gain, detune and wave glide to the knob, the octave is set at once', async () => {
      const { onPress, voices, param, osc1, audioCtx } = await setup();
      osc1[1].setWaveTable([
        [0, 1, 0, -1],
        [1, 0, -1, 0],
        [0, -1, 0, 1],
      ]);
      onPress([4, 'C']);
      const [voice] = voices();
      const now = audioCtx.currentTime;

      osc1[1].setGain(0.1);
      osc1[1].setOscValue('detune', 30);
      osc1[1].setPosition(2);
      osc1[1].setOscValue('octave', 1);

      expect(calls(param(voice, 'gain1'), 'setTargetAtTime')).toEqual([[0.1, now, expect.any(Number)]]);
      expect(calls(param(voice, 'spread1'), 'setTargetAtTime')).toEqual([[30, now, expect.any(Number)]]);
      expect(calls(param(voice, 'position1'), 'setTargetAtTime')).toEqual([[1, now, expect.any(Number)]]);
      expect(calls(param(voice, 'detune1'), 'setTargetAtTime')).toEqual([]);
      expect(calls(param(voice, 'detune1'), 'setValueAtTime').at(-1)).toEqual([1200, now]);
    });

    it('a glide settles exactly within about 20 ms, a newer value cancels it', async () => {
      const { onPress, voices, param, osc1, travel } = await setup();
      onPress([4, 'C']);
      const [voice] = voices();
      osc1[1].setGain(0.1);
      const gain = param(voice, 'gain1');
      const [[, settle]] = calls(gain, 'setValueAtTime').filter(([value]) => value === 0.1);
      expect(settle).toBeGreaterThan(0.01);
      expect(settle).toBeLessThan(0.03);

      osc1[1].setGain(0.2);
      expect(gain.cancelScheduledValues).toHaveBeenLastCalledWith(0);
      await travel(0.1);
      expect(gain.value).toBeCloseTo(0.2, 5);
    });

    it('the voices of the second oscillator follow its knobs', async () => {
      const { onPress, voices, param, osc2 } = await setup();
      onPress([4, 'C']);
      const [voice] = voices();
      osc2[1].setGain(0.9);
      expect(calls(param(voice, 'gain2'), 'setTargetAtTime')).toEqual([[0.9, 0, expect.any(Number)]]);
      expect(calls(param(voice, 'gain1'), 'setTargetAtTime')).toEqual([]);
    });

    it('a released note follows them until it has ended', async () => {
      const { onPress, onRelease, voices, param, osc1, end } = await setup();
      onPress([4, 'C']);
      onRelease([4, 'C']);
      const [voice] = voices();
      osc1[1].setGain(0.1);
      expect(calls(param(voice, 'gain1'), 'setTargetAtTime')).toHaveLength(1);

      end(voice);
      osc1[1].setGain(0.2);
      expect(calls(param(voice, 'gain1'), 'setTargetAtTime')).toHaveLength(1);
    });

    it('gives new notes the phases of the knobs at the note on', async () => {
      const { onPress, voices, osc1, osc2 } = await setup();
      osc2[1].toggleActive();
      osc1[1].setOscValue('phase', 0.25);
      osc1[1].setOscValue('phaseRand', 0.5);
      osc2[1].setOscValue('phase', 0.75);
      onPress([4, 'C']);
      const [voice] = voices();
      expect((voice.options.processorOptions as { osc: unknown[] }).osc).toEqual([
        expect.objectContaining({ phase: 0.25, phaseRand: 0.5 }),
        expect.objectContaining({ phase: 0.75, phaseRand: 1 }),
      ]);
    });

    it('creates a note with options under 1 KB, no table in them', async () => {
      const { onPress, voices, osc2 } = await setup();
      osc2[1].toggleActive();
      osc2[1].setOscValue('unison', 8);
      onPress([4, 'C']);
      const [voice] = voices();
      expect(JSON.stringify(voice.options.processorOptions).length).toBeLessThan(1024);
    });

    it('unison and on/off take effect on new notes only', async () => {
      const { onPress, voices, osc1, osc2 } = await setup();
      onPress([4, 'C']);
      osc1[1].setOscValue('unison', 7);
      osc2[1].toggleActive();
      onPress([4, 'E']);
      const [first, second] = voices().map(
        (voice) => (voice.options.processorOptions as { osc: ({ unison: number } | null)[] }).osc
      );
      expect(first[0]?.unison).toBe(2);
      expect(first[1]).toBeNull();
      expect(second[0]?.unison).toBe(7);
      expect(second[1]).not.toBeNull();
    });
  });

  describe('mod buses', () => {
    it('connects no bus without a source: the params of a held note stay constant', async () => {
      const { onPress, osc1 } = await setup();
      onPress([4, 'C']);
      Object.values(osc1[0].buses).forEach((bus) => expect(bus.connect).not.toHaveBeenCalled());
    });

    it('connects the bus of a param with a source to the new voices of the active oscillators', async () => {
      const { onPress, voices, param, osc1, osc2, audioCtx } = await setup();
      const lfo = audioCtx.createOscillator();
      osc1[1].connectBus('position', lfo);
      osc2[1].connectBus('position', lfo);
      expect(lfo.connect).toHaveBeenCalledWith(osc1[0].buses.position);

      onPress([4, 'C']);
      onPress([4, 'E']);

      voices().forEach((voice) =>
        expect(osc1[0].buses.position.connect).toHaveBeenCalledWith(param(voice, 'position1'))
      );
      expect(osc1[0].buses.gain.connect).not.toHaveBeenCalled();
      // osc2 is off for the notes
      expect(osc2[0].buses.position.connect).not.toHaveBeenCalled();
    });

    it('connects the playing notes when a bus gets its first source, lets them go after its last', async () => {
      const { onPress, voices, param, osc1, audioCtx } = await setup();
      onPress([4, 'C']);
      const [voice] = voices();
      const bus = osc1[0].buses.detune;
      const [lfo, envelope] = [audioCtx.createOscillator(), audioCtx.createOscillator()];

      osc1[1].connectBus('detune', lfo);
      osc1[1].connectBus('detune', envelope);
      expect(bus.connect).toHaveBeenCalledTimes(1);
      expect(bus.connect).toHaveBeenCalledWith(param(voice, 'detune1'));

      osc1[1].disconnectBus('detune', lfo);
      expect(bus.disconnect).not.toHaveBeenCalled();
      osc1[1].disconnectBus('detune', envelope);
      expect(bus.disconnect).toHaveBeenCalledWith(param(voice, 'detune1'));
      expect(envelope.disconnect).toHaveBeenCalledWith(bus);
    });

    it('disconnects the buses from the node of a voice that has ended', async () => {
      const { onPress, onRelease, voices, param, osc1, end, audioCtx } = await setup();
      osc1[1].connectBus('gain', audioCtx.createOscillator());
      onPress([4, 'C']);
      onRelease([4, 'C']);
      const [voice] = voices();
      const { buses } = osc1[0];
      expect(buses.gain.disconnect).not.toHaveBeenCalled();
      end(voice);
      expect(buses.gain.disconnect).toHaveBeenCalledWith(param(voice, 'gain1'));
      // a later source doesn't reach it
      osc1[1].connectBus('spread', audioCtx.createOscillator());
      expect(buses.spread.connect).not.toHaveBeenCalled();
    });
  });

  describe('loading', () => {
    it('does not play the notes pressed before the oscillator is ready, nor later', async () => {
      const { onPress, voices, synthModel } = await setup({ ready: false });
      onPress([4, 'C']);
      expect(synthModel.$voicesCount.value).toBe(0);
      await flush();
      expect(voices()).toHaveLength(0);

      onPress([4, 'E']);
      expect(voices()).toHaveLength(1);
      expect(synthModel.$voicesCount.value).toBe(1);
    });

    it('plays nothing without AudioWorklet', async () => {
      withoutAudioWorklet();
      const { onPress, wavetables, synthModel, audioCtx } = await setup();
      expect(wavetables.$status.value).toBe('unsupported');
      onPress([4, 'C']);
      expect(synthModel.$voicesCount.value).toBe(0);
      expect(registrar.getAudioNodes(audioCtx as never, 'OscillatorNode')).toHaveLength(0);
    });

    it('plays nothing while the oscillator failed, again after a retry', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { onPress, wavetables, synthModel } = await setup();
      // the worker fails
      WorkerStub.created.at(-1)?.onerror?.(new Event('error'));
      expect(wavetables.$status.value).toBe('failed');
      onPress([4, 'C']);
      expect(synthModel.$voicesCount.value).toBe(0);

      wavetables.retry();
      await flush();
      onPress([4, 'E']);
      expect(synthModel.$voicesCount.value).toBe(1);
      error.mockRestore();
    });
  });

  describe('voice starts', () => {
    it('traces no voice unless its starts are observed', async () => {
      const { onPress, voices } = await setup();
      onPress([4, 'A']);
      expect(voices()[0].options.processorOptions).not.toHaveProperty('trace');
    });

    it('traces the voices while observed: their starts come with their note', async () => {
      const { onPress, voices, synthModel, end } = await setup();
      const starts: unknown[] = [];
      const subscription = synthModel.$voiceStarts.subscribe((start) => starts.push(start));
      onPress([4, 'A']);
      const [voice] = voices();
      expect(voice.options.processorOptions).toMatchObject({ trace: true });
      voice.port.onmessage?.({ data: { started: 140, scheduled: 0 } });
      expect(starts).toEqual([{ note: 'A4', scheduled: 0, started: 140 }]);
      // a start doesn't end the voice, the end still does
      expect(voice.disconnect).not.toHaveBeenCalled();
      end(voice);
      expect(voice.disconnect).toHaveBeenCalled();

      subscription.unsubscribe();
      onPress([4, 'C']);
      expect(voices()[1].options.processorOptions).not.toHaveProperty('trace');
    });
  });

  it('stops listening to the input after stop', async () => {
    const { onPress, voices } = await setup();
    stopModels();
    onPress([4, 'C']);
    expect(voices()).toHaveLength(0);
  });

  describe('snapshot', () => {
    it('exposes voicing settings under "v"', async () => {
      const { synthActions } = await setup();
      synthActions.setLegato(true);
      synthActions.setPortamento(120);
      synthActions.setMaxVoices(4);
      expect(getSnapshot()['v']).toEqual({ leg: true, port: 120, max: 4 });
    });

    it('applies falsy values and keeps settings missing in the snapshot', async () => {
      const { synthModel, synthActions } = await setup();
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
