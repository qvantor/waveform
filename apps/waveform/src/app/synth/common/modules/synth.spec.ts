import { registrar } from 'standardized-audio-context-mock';
import { ENVELOPE_DEFAULTS } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createSynth, stopModels } from '../../../../test-utils/models';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { WorkerStub } from '../../../../test-utils/worker-stub';
import { getFq } from '../../services';
import { RELEASE_GATE, VOICE_PROCESSOR } from '../wavetable/wavetable-osc-params';
import type { VoiceOptions } from '../wavetable/wavetable-osc-dsp';
import { glideValue } from './glide';

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
  // the options a voice node was created with
  const options = (voice: VoiceNode) => voice.options.processorOptions as VoiceOptions;
  // the processor of a voice tells its node it has ended
  const end = (voice: VoiceNode) => voice.port.onmessage?.({ data: { ended: true } });
  const travel = (seconds: number) => registrar.getDeLorean(audioCtx as never)?.travel(seconds);
  // the milliseconds of performance.now, the time a key is held: they stay unless a test moves them
  const wall = jest.spyOn(performance, 'now').mockReturnValue(0);

  return {
    ...modules,
    envelopeModel: modules.envelopes,
    audioCtx,
    preGain,
    wavetables,
    onPress,
    onRelease,
    synthModel,
    synthActions,
    voices,
    param,
    gains,
    options,
    end,
    travel,
    wall,
  };
};

type Method =
  | 'setValueAtTime'
  | 'setTargetAtTime'
  | 'linearRampToValueAtTime'
  | 'exponentialRampToValueAtTime'
  | 'cancelScheduledValues';
const calls = (param: AudioParam, method: Method) => (param[method] as jest.Mock).mock.calls;
// the order a call was made in among all the mocks
const order = (param: AudioParam, method: Method, index = 0) =>
  (param[method] as jest.Mock).mock.invocationCallOrder[index];

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
      envelopes: [ENVELOPE_DEFAULTS.env1, ENVELOPE_DEFAULTS.env2, ENVELOPE_DEFAULTS.env3],
      envStart: 0,
      phrase: expect.any(Number),
      routes: [],
      filter: null,
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

  it('creates no native oscillators and no gains: the volume is in the processor', async () => {
    const { onPress, audioCtx, gains } = await setup();
    onPress([4, 'A']);
    expect(registrar.getAudioNodes(audioCtx as never, 'OscillatorNode')).toHaveLength(0);
    expect(gains()).toEqual([]);
  });

  it('connects the node of a voice straight to the synth output', async () => {
    const { onPress, voices, preGain } = await setup();
    onPress([4, 'A']);
    const [voice] = voices();
    expect(voice.connect).toHaveBeenCalledWith(preGain);
  });

  it('gives a note the envelopes at its note on, they start with it', async () => {
    const { onPress, voices, options, envelopeModel, travel } = await setup();
    const [{ $envelopes }, { setEnvelopeValue }] = envelopeModel;
    setEnvelopeValue('env1', 'attack', 0.1);
    setEnvelopeValue('env2', 'decay', 3);
    await travel(1);

    onPress([4, 'C']);
    const { env1, env2, env3 } = $envelopes.value;
    // an edit changes the next notes only
    setEnvelopeValue('env1', 'sustain', 0.5);
    onPress([4, 'E']);

    const [c, e] = voices();
    expect(options(c)).toMatchObject({ envelopes: [env1, env2, env3], envStart: 1, start: 1 });
    expect(options(e).envelopes[0]).toEqual({ ...env1, sustain: 0.5 });
  });

  it('releases a note: its gate tells the processor now how long its key was held', async () => {
    const { onPress, onRelease, voices, param, synthModel, envelopeModel, travel } = await setup();
    envelopeModel[1].setEnvelopeValue('env1', 'release', 0.5);
    onPress([4, 'C']);
    await travel(1);

    onRelease([4, 'C']);

    const [voice] = voices();
    // the key was held 0 ms by the clock of the page: the processor releases it where it sees the gate
    expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE, 1]]);
    // it sounds until its release is over
    expect(synthModel.$voicesCount.value).toBe(1);
    voice.port.onmessage?.({ data: { ended: true } });
    expect(synthModel.$voicesCount.value).toBe(0);
  });

  it('releases a note shorter than a step of the context time as long after its start as its key was held', async () => {
    const { onPress, onRelease, voices, param, synthModel, wall } = await setup();
    onPress([4, 'C']);
    // currentTime hasn't moved (it moves by device buffers), the key was held 4 ms
    wall.mockReturnValue(4);
    onRelease([4, 'C']);
    expect(calls(param(voices()[0], 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE + 0.004, 0]]);
    // the fx release their envelopes then too
    expect(synthModel.$fxNote.value?.release).toBe(0.004);
  });

  it('releases a note held over a stalled clock at most 50 ms after now', async () => {
    const { onPress, onRelease, voices, param, synthModel, wall } = await setup();
    onPress([4, 'C']);
    wall.mockReturnValue(2000);
    onRelease([4, 'C']);
    // the processor too releases it at most 50 ms after it sees the gate
    expect(calls(param(voices()[0], 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE + 2, 0]]);
    expect(synthModel.$fxNote.value?.release).toBe(0.05);
  });

  it('takes the node of a voice off once it has ended', async () => {
    const { onPress, onRelease, voices, end } = await setup();
    onPress([4, 'C']);
    onRelease([4, 'C']);
    const [voice] = voices();
    expect(voice.disconnect).not.toHaveBeenCalled();

    end(voice);

    expect(voice.disconnect).toHaveBeenCalled();
  });

  it('takes a held voice off when its processor fails, the others and new notes play on', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { onPress, onRelease, voices, wavetables, osc1, audioCtx } = await setup();
    osc1[1].connectBus('gain', audioCtx.createOscillator());
    onPress([4, 'C']);
    onPress([4, 'E']);
    const [c, e] = voices();

    c.onprocessorerror?.(new Event('processorerror'));

    expect(error).toHaveBeenCalledWith('A voice of the wavetable oscillator failed', expect.any(Event));
    expect(c.disconnect).toHaveBeenCalled();
    expect(osc1[0].buses.gain.disconnect).toHaveBeenCalledTimes(1);
    expect(e.disconnect).not.toHaveBeenCalled();
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

  describe('poly', () => {
    it('counts the released voices until they end', async () => {
      const { onPress, onRelease, voices, end, synthModel, envelopeModel } = await setup();
      envelopeModel[1].setEnvelopeValue('env1', 'release', 32);
      onPress([4, 'C']);
      onPress([4, 'E']);
      onRelease([4, 'C']);
      expect(synthModel.$voicesCount.value).toBe(2);
      end(voices()[0]);
      expect(synthModel.$voicesCount.value).toBe(1);
    });

    it('a release of 32 s gives no more sounding voices than Poly: the oldest released one is stolen', async () => {
      const { onPress, onRelease, voices, param, synthModel, synthActions, envelopeModel } = await setup();
      // released at their start at full level (with an attack at 0: they would end there)
      envelopeModel[1].setEnvelopeValue('env1', 'attack', 0);
      envelopeModel[1].setEnvelopeValue('env1', 'release', 32);
      synthActions.setMaxVoices(3);
      const notes = ['C', 'D', 'E', 'F', 'G', 'A'] as const;
      notes.forEach((note) => {
        onPress([4, note]);
        onRelease([4, note]);
        expect(synthModel.$voicesCount.value).toBeLessThanOrEqual(3);
      });
      // C, D and E fade out (gate below 0), F, G and A release on
      const stolen = voices().map((voice) => calls(param(voice, 'gate'), 'setValueAtTime').at(-1)?.[0]);
      expect(stolen).toEqual([-1, -1, -1, RELEASE_GATE, RELEASE_GATE, RELEASE_GATE]);
      expect(synthModel.$voicesCount.value).toBe(3);
    });

    it('steals a released voice before a held one, the oldest held one when none is released', async () => {
      const { onPress, onRelease, voices, param, synthActions, envelopeModel } = await setup();
      envelopeModel[1].setEnvelopeValue('env1', 'attack', 0);
      envelopeModel[1].setEnvelopeValue('env1', 'release', 32);
      synthActions.setMaxVoices(3);
      onPress([4, 'C']);
      onPress([4, 'D']);
      onPress([4, 'E']);
      onRelease([4, 'E']);
      onPress([4, 'F']);
      const gate = (index: number) => calls(param(voices()[index], 'gate'), 'setValueAtTime').at(-1)?.[0];
      // E, released, is stolen, C and D are held on
      expect([gate(0), gate(1), gate(2)]).toEqual([undefined, undefined, -1]);
      onPress([4, 'G']);
      expect(gate(0)).toBe(-1);
      expect(gate(1)).toBeUndefined();
    });

    it('steals the quietest released voice, not the oldest: the smallest step', async () => {
      const { onPress, onRelease, voices, param, synthActions, envelopeModel, travel, wall } = await setup();
      envelopeModel[1].setEnvelopeValue('env1', 'attack', 1);
      envelopeModel[1].setEnvelopeValue('env1', 'release', 2);
      synthActions.setMaxVoices(2);
      // C released on its sustain (1), D in its attack (0.2)
      onPress([4, 'C']);
      await travel(1);
      wall.mockReturnValue(1000);
      onRelease([4, 'C']);
      onPress([4, 'D']);
      await travel(0.2);
      wall.mockReturnValue(1200);
      onRelease([4, 'D']);
      // at 1.3 C is at 0.85, D at 0.19
      await travel(0.1);
      onPress([4, 'E']);
      const [c, d] = voices();
      expect(calls(param(d, 'gate'), 'setValueAtTime').at(-1)?.[0]).toBe(-1);
      expect(calls(param(c, 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE + 1, 1]]);
    });

    it('takes the level of a legato note from the start of its phrase', async () => {
      const { onPress, onRelease, voices, param, synthActions, envelopeModel, travel, wall } = await setup();
      envelopeModel[1].setEnvelopeValue('env1', 'attack', 1);
      envelopeModel[1].setEnvelopeValue('env1', 'release', 2);
      synthActions.setLegato(true);
      synthActions.setMaxVoices(2);
      // D joins the phrase of C at 0.9; C released at 1, D at 1.2, both at 1 (from its own start D would be
      // at 0.3)
      onPress([4, 'C']);
      await travel(0.9);
      wall.mockReturnValue(900);
      onPress([4, 'D']);
      await travel(0.1);
      wall.mockReturnValue(1000);
      onRelease([4, 'C']);
      await travel(0.2);
      wall.mockReturnValue(1200);
      onRelease([4, 'D']);
      // at 1.5 C is at 0.75, D at 0.85
      await travel(0.3);
      onPress([4, 'E']);
      const [c, d] = voices();
      expect(calls(param(c, 'gate'), 'setValueAtTime').at(-1)?.[0]).toBe(-1);
      expect(calls(param(d, 'gate'), 'setValueAtTime').at(-1)?.[0]).toBeCloseTo(RELEASE_GATE + 0.3);
    });

    it('does not count a released voice whose release is over', async () => {
      const { onPress, onRelease, voices, param, synthActions, travel, envelopeModel } = await setup();
      envelopeModel[1].setEnvelopeValue('env1', 'release', 1);
      synthActions.setMaxVoices(2);
      onPress([4, 'C']);
      onRelease([4, 'C']);
      onPress([4, 'D']);
      // the release of C is over, its ended message has not arrived yet
      await travel(2);
      onPress([4, 'E']);
      const [c, d] = voices();
      // released at 0, not stolen
      expect(calls(param(c, 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE, 0]]);
      expect(calls(param(d, 'gate'), 'setValueAtTime')).toEqual([]);
    });

    it('counts a released voice processed late until its release from its first sample is over', async () => {
      const { onPress, onRelease, voices, param, synthActions, travel, envelopeModel, audioCtx } =
        await setup();
      envelopeModel[1].setEnvelopeValue('env1', 'attack', 0);
      envelopeModel[1].setEnvelopeValue('env1', 'release', 1);
      synthActions.setMaxVoices(2);
      onPress([4, 'C']);
      // its processor started it 40 ms late and released it there: its release is over at 1.04
      voices()[0].port.onmessage?.({
        data: { started: Math.round(0.04 * audioCtx.sampleRate), scheduled: 0 },
      });
      onRelease([4, 'C']);
      onPress([4, 'D']);
      await travel(1.02);
      onPress([4, 'E']);
      const [c, d] = voices();
      // C still sounds: stolen for E
      expect(calls(param(c, 'gate'), 'setValueAtTime').at(-1)?.[0]).toBe(-1);
      expect(calls(param(d, 'gate'), 'setValueAtTime')).toEqual([]);
    });
  });

  it('takes a stolen voice off once its node has ended', async () => {
    const { onPress, voices, end, synthActions } = await setup();
    synthActions.setMaxVoices(2);
    onPress([4, 'C']);
    onPress([4, 'E']);
    onPress([4, 'G']);
    const [c, e] = voices();

    end(c);

    expect(c.disconnect).toHaveBeenCalled();
    expect(e.disconnect).not.toHaveBeenCalled();
  });

  it('a released voice whose level is 0 at its release ends there: not counted', async () => {
    const { onPress, onRelease, voices, param, synthActions, synthModel } = await setup();
    synthActions.setMaxVoices(2);
    // released at its start: its attack (5 ms) hasn't begun, its processor ends it there
    onPress([4, 'C']);
    onRelease([4, 'C']);
    onPress([4, 'D']);
    onPress([4, 'E']);
    expect(synthModel.$voicesCount.value).toBe(2);
    expect(calls(param(voices()[0], 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE, 0]]);
  });

  it('glides from the previous held note with portamento, along the curve', async () => {
    const { onPress, voices, param, synthActions, travel } = await setup();
    synthActions.setPortamento(200);

    onPress([4, 'C']);
    await travel(1);
    onPress([4, 'E']);

    const [, glide] = voices();
    const frequency = param(glide, 'frequency');
    expect(frequency.value).toBeCloseTo(getFq([4, 'C']));
    expect(calls(frequency, 'setValueAtTime')).toEqual([[getFq([4, 'C']), 1]]);
    const ramps = calls(frequency, 'exponentialRampToValueAtTime');
    expect(ramps).toHaveLength(8);
    expect(ramps[7]).toEqual([getFq([4, 'E']), expect.closeTo(1.2, 9)]);
  });

  it('glides in legato too: the new voice goes on with the envelopes of the phrase', async () => {
    const { onPress, voices, param, options, synthActions, travel } = await setup();
    synthActions.setLegato(true);
    synthActions.setPortamento(100);
    onPress([4, 'C']);
    await travel(1);
    onPress([4, 'E']);
    const [c, e] = voices();
    expect(options(e)).toMatchObject({ envStart: 0, phrase: options(c).phrase });
    expect(calls(param(e, 'frequency'), 'exponentialRampToValueAtTime').at(-1)).toEqual([
      getFq([4, 'E']),
      expect.closeTo(1.1, 9),
    ]);
    // the note before plays on
    expect(calls(param(c, 'gate'), 'setValueAtTime')).toEqual([]);
  });

  it('does not glide at a portamento of 0', async () => {
    const { onPress, voices, param } = await setup();
    onPress([4, 'C']);
    onPress([4, 'E']);
    const [, e] = voices();
    expect(calls(param(e, 'frequency'), 'setValueAtTime')).toEqual([]);
    expect(param(e, 'frequency').value).toBeCloseTo(getFq([4, 'E']));
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

  describe('mono', () => {
    const mono = async (portamento = 100, legato = true) => {
      const context = await setup();
      context.synthActions.setMaxVoices(1);
      context.synthActions.setLegato(legato);
      context.synthActions.setPortamento(portamento);
      return context;
    };
    const fq = (name: 'A' | 'B' | 'C' | 'D') => getFq([4, name]);

    it('in legato a note over the held one takes its voice over: it glides there, its envelopes go on', async () => {
      const { onPress, voices, param, synthModel, travel } = await mono();
      onPress([4, 'A']);
      await travel(1);
      onPress([4, 'B']);

      expect(voices()).toHaveLength(1);
      const [voice] = voices();
      const frequency = param(voice, 'frequency');
      // held where it is, what comes after cancelled, then the curve to B
      expect(calls(frequency, 'setValueAtTime')).toEqual([[fq('A'), 1]]);
      expect(calls(frequency, 'cancelScheduledValues')).toEqual([[expect.closeTo(1, 3)]]);
      const ramps = calls(frequency, 'exponentialRampToValueAtTime');
      expect(ramps).toHaveLength(8);
      expect(ramps[7]).toEqual([fq('B'), expect.closeTo(1.1, 9)]);
      expect(order(frequency, 'setValueAtTime')).toBeLessThan(
        order(frequency, 'exponentialRampToValueAtTime')
      );
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([]);
      expect(synthModel.$voicesCount.value).toBe(1);
    });

    it('steps to the note at a portamento of 0', async () => {
      const { onPress, voices, param, travel } = await mono(0);
      onPress([4, 'A']);
      await travel(1);
      onPress([4, 'B']);
      const frequency = param(voices()[0], 'frequency');
      expect(calls(frequency, 'setValueAtTime')).toEqual([[fq('B'), 1]]);
      expect(calls(frequency, 'exponentialRampToValueAtTime')).toEqual([]);
    });

    it('goes on from where a glide the next note interrupts is', async () => {
      const { onPress, voices, param, travel } = await mono(200);
      onPress([4, 'A']);
      await travel(1);
      onPress([4, 'B']);
      await travel(0.05);
      onPress([4, 'C']);
      const frequency = param(voices()[0], 'frequency');
      const at = glideValue({ from: fq('A'), to: fq('B'), start: 1, seconds: 0.2 }, 1.05);
      expect(at).toBeGreaterThan(fq('A'));
      expect(calls(frequency, 'setValueAtTime')[1]).toEqual([expect.closeTo(at, 9), 1.05]);
      expect(calls(frequency, 'cancelScheduledValues')[1]).toEqual([expect.closeTo(1.05, 3)]);
      expect(calls(frequency, 'exponentialRampToValueAtTime').at(-1)).toEqual([
        fq('C'),
        expect.closeTo(1.25, 9),
      ]);
      expect(order(frequency, 'setValueAtTime', 1)).toBeLessThan(
        order(frequency, 'exponentialRampToValueAtTime', 8)
      );
    });

    it('hands the voice back to the key below when the key on top is released, the last key releases it', async () => {
      const { onPress, onRelease, voices, param, synthModel, travel } = await mono();
      onPress([4, 'A']);
      onPress([4, 'B']);
      await travel(1);
      onRelease([4, 'B']);
      const [voice] = voices();
      expect(calls(param(voice, 'frequency'), 'exponentialRampToValueAtTime').at(-1)).toEqual([
        fq('A'),
        expect.closeTo(1.1, 9),
      ]);
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([]);

      onRelease([4, 'A']);
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE, 1]]);
      expect(voices()).toHaveLength(1);
      expect(synthModel.$voicesCount.value).toBe(1);
    });

    it('a key below the top released changes nothing', async () => {
      const { onPress, onRelease, voices, param } = await mono();
      onPress([4, 'A']);
      onPress([4, 'B']);
      const [voice] = voices();
      const frequency = param(voice, 'frequency');
      const scheduled = calls(frequency, 'exponentialRampToValueAtTime').length;
      onRelease([4, 'A']);
      expect(calls(frequency, 'exponentialRampToValueAtTime')).toHaveLength(scheduled);
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([]);
      // B is the last key
      onRelease([4, 'B']);
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE, 0]]);
    });

    it('a key pressed again goes on top', async () => {
      const { onPress, onRelease, voices, param } = await mono();
      onPress([4, 'A']);
      onPress([4, 'B']);
      onPress([4, 'C']);
      onRelease([4, 'A']);
      onPress([4, 'A']);
      // A released: back to C, then B
      const ramps = () => calls(param(voices()[0], 'frequency'), 'exponentialRampToValueAtTime');
      onRelease([4, 'A']);
      expect(ramps().at(-1)?.[0]).toBe(fq('C'));
      onRelease([4, 'C']);
      expect(ramps().at(-1)?.[0]).toBe(fq('B'));
      expect(voices()).toHaveLength(1);
    });

    it('the fx follow the voice: its glide in legato is no new note, its last key releases them', async () => {
      const { onPress, onRelease, synthModel, travel } = await mono();
      onPress([4, 'A']);
      const note = synthModel.$fxNote.value;
      await travel(1);
      onPress([4, 'B']);
      onRelease([4, 'A']);
      expect(synthModel.$fxNote.value).toBe(note);
      await travel(1);
      onRelease([4, 'B']);
      expect(synthModel.$fxNote.value).toMatchObject({ start: 0, release: 2 });
    });

    it('out of legato a note over the held one glides the voice there and starts its envelopes again', async () => {
      const { onPress, onRelease, voices, param, synthModel, travel } = await mono(100, false);
      onPress([4, 'A']);
      await travel(1);
      onPress([4, 'B']);
      expect(voices()).toHaveLength(1);
      const [voice] = voices();
      // the gate held at its other value, now
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([[1.5, 1]]);
      expect(calls(param(voice, 'frequency'), 'exponentialRampToValueAtTime').at(-1)).toEqual([
        fq('B'),
        expect.closeTo(1.1, 9),
      ]);
      // back to A: again, at the first value
      await travel(0.5);
      onRelease([4, 'B']);
      expect(calls(param(voice, 'gate'), 'setValueAtTime').at(-1)).toEqual([1, 1.5]);
      expect(synthModel.$voicesCount.value).toBe(1);
    });

    it('two notes at one time out of legato: the gate stays at the other value (the last replaces the first)', async () => {
      const { onPress, voices, param, travel } = await mono(0, false);
      onPress([4, 'A']);
      await travel(1);
      onPress([4, 'B']);
      onPress([4, 'C']);
      expect(calls(param(voices()[0], 'gate'), 'setValueAtTime')).toEqual([
        [1.5, 1],
        [1.5, 1],
      ]);
      await travel(0.5);
      onPress([4, 'D']);
      expect(calls(param(voices()[0], 'gate'), 'setValueAtTime').at(-1)).toEqual([1, 1.5]);
    });

    it('a note on the voice in its release: at once, its release off, its envelopes again from their levels', async () => {
      const { onPress, onRelease, voices, param, synthModel, envelopeModel, travel, wall } = await mono(100);
      const { env1, env2, env3 } = envelopeModel[0].$envelopes.value;
      envelopeModel[1].setEnvelopeValue('env1', 'release', 1);
      onPress([4, 'A']);
      await travel(1);
      wall.mockReturnValue(1000);
      onRelease([4, 'A']);
      await travel(0.2);
      onPress([4, 'B']);
      expect(voices()).toHaveLength(1);
      const [voice] = voices();
      // no glide: no key was held
      expect(calls(param(voice, 'frequency'), 'setValueAtTime')).toEqual([[fq('B'), expect.closeTo(1.2, 9)]]);
      expect(calls(param(voice, 'frequency'), 'exponentialRampToValueAtTime')).toEqual([]);
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([
        [RELEASE_GATE + 1, 1],
        [1.5, expect.closeTo(1.2, 9)],
      ]);
      expect(synthModel.$voicesCount.value).toBe(1);
      // the fx: a new note from now, ENV 1 from 0.8 (its release from 1 at 1 s), ENV 2 and 3 from 0 (decayed)
      expect(synthModel.$fxNote.value).toEqual({
        envelopes: [{ ...env1, release: 1 }, env2, env3],
        start: expect.closeTo(1.2, 9),
        release: null,
        from: [expect.closeTo(0.8, 9), 0, 0],
      });
    });

    it('a note on the voice in its release released at once: a sample after the gate held, not instead of it', async () => {
      const { onPress, onRelease, voices, param, audioCtx, envelopeModel, travel, wall } = await mono(
        0,
        false
      );
      envelopeModel[1].setEnvelopeValue('env1', 'release', 1);
      onPress([4, 'A']);
      await travel(0.5);
      wall.mockReturnValue(500);
      onRelease([4, 'A']);
      await travel(0.2);
      onPress([4, 'B']);
      onRelease([4, 'B']);
      expect(voices()).toHaveLength(1);
      expect(calls(param(voices()[0], 'gate'), 'setValueAtTime')).toEqual([
        [RELEASE_GATE + 0.5, 0.5],
        [1.5, expect.closeTo(0.7, 9)],
        [RELEASE_GATE, expect.closeTo(0.7 + 1 / audioCtx.sampleRate, 9)],
      ]);
    });

    it('releases a note as long after it started the envelopes again as its key was held', async () => {
      const { onPress, onRelease, voices, param, synthModel, travel, wall } = await mono(0, false);
      onPress([4, 'A']);
      await travel(1);
      wall.mockReturnValue(1000);
      onPress([4, 'B']);
      await travel(0.3);
      wall.mockReturnValue(1300);
      onRelease([4, 'A']);
      onRelease([4, 'B']);
      expect(calls(param(voices()[0], 'gate'), 'setValueAtTime').at(-1)).toEqual([
        expect.closeTo(RELEASE_GATE + 0.3, 9),
        expect.closeTo(1.3, 9),
      ]);
      expect(synthModel.$fxNote.value).toMatchObject({ start: 1, release: expect.closeTo(1.3, 9) });
    });

    it('a new voice for a note when the release of the voice ends before its processor would see the gate', async () => {
      const { onPress, onRelease, voices, param, envelopeModel, travel, wall } = await mono(100, false);
      envelopeModel[1].setEnvelopeValue('env1', 'release', 0.1);
      onPress([4, 'A']);
      await travel(1);
      wall.mockReturnValue(1000);
      onRelease([4, 'A']);
      // its release ends at 1.1, within 50 ms of now
      await travel(0.07);
      onPress([4, 'B']);
      const [a, b] = voices();
      expect(calls(param(a, 'gate'), 'setValueAtTime').at(-1)?.[0]).toBe(-1);
      expect(b).toBeDefined();
    });

    it('a new voice for a note that would start envelopes other than those of its voice, a glide keeps it', async () => {
      const { onPress, voices, param, synthActions, envelopeModel, options } = await mono(100, false);
      onPress([4, 'A']);
      envelopeModel[1].setEnvelopeValue('env1', 'attack', 0.2);
      onPress([4, 'B']);
      const [a, b] = voices();
      expect(calls(param(a, 'gate'), 'setValueAtTime').at(-1)?.[0]).toBe(-1);
      expect(options(b).envelopes[0].attack).toBe(0.2);
      // gliding from A
      expect(calls(param(b, 'frequency'), 'setValueAtTime')).toEqual([[fq('A'), 0]]);
      // in legato its envelopes go on: the voice glides on
      synthActions.setLegato(true);
      envelopeModel[1].setEnvelopeValue('env1', 'attack', 0.3);
      onPress([4, 'C']);
      expect(voices()).toHaveLength(2);
      expect(calls(param(b, 'frequency'), 'exponentialRampToValueAtTime').at(-1)?.[0]).toBe(fq('C'));
    });

    it('Poly leaving 1 while notes play: the voice plays on as a voice of its note, none hangs', async () => {
      const { onPress, onRelease, voices, param, synthActions } = await mono();
      onPress([4, 'A']);
      onPress([4, 'B']);
      synthActions.setMaxVoices(4);
      onRelease([4, 'A']);
      const [voice] = voices();
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([]);
      onPress([4, 'C']);
      expect(voices()).toHaveLength(2);
      onRelease([4, 'B']);
      onRelease([4, 'C']);
      voices().forEach((item) =>
        expect(calls(param(item, 'gate'), 'setValueAtTime').at(-1)?.[0]).toBe(RELEASE_GATE)
      );
    });

    it('Poly coming to 1: the voices above it are stolen at the next note, none hangs', async () => {
      const { onPress, onRelease, voices, param, synthActions, synthModel } = await setup();
      synthActions.setLegato(true);
      onPress([4, 'A']);
      onPress([4, 'B']);
      onPress([4, 'C']);
      synthActions.setMaxVoices(1);
      onPress([4, 'D']);
      const gates = () => voices().map((voice) => calls(param(voice, 'gate'), 'setValueAtTime').at(-1)?.[0]);
      expect(gates()).toEqual([-1, -1, -1, undefined]);
      expect(synthModel.$voicesCount.value).toBe(1);
      (['A', 'B', 'C', 'D'] as const).forEach((name) => onRelease([4, name]));
      expect(gates()).toEqual([-1, -1, -1, RELEASE_GATE]);
      expect(synthModel.$voicesCount.value).toBe(1);
    });

    it('a voice that ended by itself: its keys release nothing, the next note starts a voice', async () => {
      const { onPress, onRelease, voices, param, end } = await mono();
      onPress([4, 'A']);
      onPress([4, 'B']);
      const [voice] = voices();
      end(voice);
      onRelease([4, 'A']);
      expect(calls(param(voice, 'frequency'), 'exponentialRampToValueAtTime')).toHaveLength(8);
      onPress([4, 'C']);
      expect(voices()).toHaveLength(2);
      onRelease([4, 'B']);
      onRelease([4, 'C']);
      expect(calls(param(voices()[1], 'gate'), 'setValueAtTime').at(-1)?.[0]).toBe(RELEASE_GATE);
    });
  });

  describe('legato', () => {
    it('the notes pressed while another one is held go on with its envelopes from its start', async () => {
      const { onPress, onRelease, voices, options, synthActions, envelopeModel, travel } = await setup();
      const [{ $envelopes }, { setEnvelopeValue }] = envelopeModel;
      synthActions.setLegato(true);
      await travel(1);
      onPress([4, 'C']);
      const phrase = [$envelopes.value.env1, $envelopes.value.env2, $envelopes.value.env3];
      await travel(0.5);
      setEnvelopeValue('env1', 'attack', 2);
      onPress([4, 'E']);

      const [c, e] = voices();
      expect(options(c)).toMatchObject({ start: 1, envStart: 1, envelopes: phrase });
      // not started again: the phrase's start, envelopes and number
      expect(options(e)).toMatchObject({
        start: 1.5,
        envStart: 1,
        envelopes: phrase,
        phrase: options(c).phrase,
      });

      // the next note after the last key starts a new phrase
      onRelease([4, 'C']);
      onRelease([4, 'E']);
      await travel(0.5);
      onPress([4, 'G']);
      expect(options(voices()[2])).toMatchObject({ start: 2, envStart: 2 });
      expect(options(voices()[2]).envelopes[0].attack).toBe(2);
      expect(options(voices()[2]).phrase).not.toBe(options(c).phrase);
    });

    it('a phrase started at the time the last one did is another one', async () => {
      // the last key released and the next one pressed within a device buffer: the same currentTime
      const { onPress, onRelease, voices, options, synthActions, travel } = await setup();
      synthActions.setLegato(true);
      await travel(1);
      onPress([4, 'C']);
      onRelease([4, 'C']);
      onPress([4, 'E']);
      const [c, e] = voices();
      expect(options(e)).toMatchObject({ start: 1, envStart: 1 });
      expect(options(e).phrase).not.toBe(options(c).phrase);
    });

    it('releases each voice at its own key, from the level of the phrase', async () => {
      const { onPress, onRelease, voices, param, synthActions, travel } = await setup();
      synthActions.setLegato(true);
      onPress([4, 'C']);
      onPress([4, 'E']);
      await travel(1);
      onRelease([4, 'C']);
      const [c, e] = voices();
      expect(calls(param(c, 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE, 1]]);
      expect(calls(param(e, 'gate'), 'setValueAtTime')).toEqual([]);
    });

    it('keeps a held legato note when the note under it is released', async () => {
      const { onPress, onRelease, voices, param, synthActions, synthModel } = await setup();
      synthActions.setLegato(true);
      synthActions.setMaxVoices(1);
      onPress([4, 'A']);
      onPress([4, 'B']);
      const [voice] = voices();

      onRelease([4, 'A']);
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([]);
      expect(synthModel.$voicesCount.value).toBe(1);

      onRelease([4, 'B']);
      expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE, 0]]);
      expect(synthModel.$voicesCount.value).toBe(1);
      expect(voices()).toHaveLength(1);
    });
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

  describe('modulation', () => {
    it('gives a note the routes to the params of its oscillators, in their units', async () => {
      const { onPress, voices, options, modulation, osc2 } = await setup();
      const [, { addRoute, setAmount }] = modulation;
      addRoute('env2', 'osc1.wave', 0.5);
      addRoute('env1', 'osc1.detune', -0.25);
      addRoute('env3', 'osc1.gain', 0.2);
      setAmount('env3', 'osc1.gain', 0);
      // osc2 is off for the note
      addRoute('env2', 'osc2.gain', 1);
      expect(osc2[0].$active.value).toBe(false);

      onPress([4, 'C']);

      expect(options(voices()[0]).routes).toEqual([
        { env: 1, param: 'position1', amount: 0.5, min: 0, max: 1 },
        { env: 0, param: 'spread1', amount: -25, min: 0, max: 100 },
      ]);
    });

    it('sends the playing notes, the released ones too, their new routes; nothing when theirs are the same', async () => {
      const { onPress, onRelease, voices, modulation, osc2, end } = await setup();
      const [, { addRoute, setAmount, removeRoute }] = modulation;
      onPress([4, 'C']);
      onPress([4, 'E']);
      onRelease([4, 'E']);
      const [c, e] = voices();
      const posted = (voice: VoiceNode) =>
        (voice.port.postMessage as jest.Mock).mock.calls.map(([data]) => data);

      addRoute('env2', 'osc1.gain');
      setAmount('env2', 'osc1.gain', -1);
      // the knob of an oscillator off for the notes
      addRoute('env2', 'osc2.gain');
      expect(osc2[0].$active.value).toBe(false);
      end(e);
      removeRoute('env2', 'osc1.gain');

      const route = { env: 1, param: 'gain1', min: 0, max: 1 };
      expect(posted(c)).toEqual([
        { routes: [{ ...route, amount: 0.5 }] },
        { routes: [{ ...route, amount: -1 }] },
        { routes: [] },
      ]);
      expect(posted(e)).toEqual([
        { routes: [{ ...route, amount: 0.5 }] },
        { routes: [{ ...route, amount: -1 }] },
      ]);
    });
  });

  describe('filter', () => {
    const posted = (voice: VoiceNode) =>
      (voice.port.postMessage as jest.Mock).mock.calls.map(([data]) => data);

    it('gives a note the filter while it is on, its playing notes follow its knobs', async () => {
      const { onPress, voices, options, filter } = await setup();
      const [, { toggleActive, setNumericValue, setType }] = filter;
      onPress([4, 'C']);
      toggleActive();
      setNumericValue('cutoff', 2000);
      onPress([4, 'E']);
      setType('highpass');
      toggleActive();

      const [c, e] = voices();
      expect(options(c).filter).toBeNull();
      const on = { type: 'lowpass', cutoff: 2000, resonance: 0, gain: 1 };
      expect(options(e).filter).toEqual(on);
      expect(posted(c)).toEqual([
        { filter: { ...on, cutoff: 440 } },
        { filter: on },
        { filter: { ...on, type: 'highpass' } },
        { filter: null },
      ]);
      expect(posted(e)).toEqual([{ filter: { ...on, type: 'highpass' } }, { filter: null }]);
    });

    it('routes the filter knobs in the range of its type: Cutoff in octaves, none while it is off', async () => {
      const { onPress, voices, options, filter, modulation } = await setup();
      const [, { addRoute }] = modulation;
      addRoute('env2', 'filter.cutoff', 0.5);
      addRoute('env3', 'filter.resonance', -1);
      // lowpass doesn't use its gain: the route stays, it is not applied
      addRoute('env1', 'filter.gain', 1);
      onPress([4, 'C']);
      filter[1].toggleActive();
      onPress([4, 'E']);

      const [off, on] = voices();
      expect(options(off).routes).toEqual([]);
      expect(options(on).routes).toEqual([
        {
          env: 1,
          param: 'cutoff',
          amount: expect.closeTo(0.5 * Math.log2(22050 / 10), 9),
          min: 10,
          max: 22050,
          log: true,
        },
        { env: 2, param: 'resonance', amount: -20, min: 0, max: 20 },
      ]);
    });

    it('sends the routes again when the type changes the range of a knob', async () => {
      const { onPress, voices, filter, modulation } = await setup();
      const [, { toggleActive, setType }] = filter;
      toggleActive();
      modulation[1].addRoute('env2', 'filter.gain', 0.5);
      onPress([4, 'C']);
      setType('lowshelf');

      const [voice] = voices();
      expect(posted(voice).at(-1)).toEqual({
        routes: [{ env: 1, param: 'gain', amount: 40, min: -40, max: 40 }],
      });
    });
  });

  describe('the envelopes the fx follow', () => {
    it('are those of the last note pressed, released with it', async () => {
      const { onPress, onRelease, synthModel, envelopeModel, travel } = await setup();
      const { $envelopes } = envelopeModel[0];
      const envelopes = [$envelopes.value.env1, $envelopes.value.env2, $envelopes.value.env3];
      expect(synthModel.$fxNote.value).toBeNull();
      await travel(1);
      onPress([4, 'C']);
      expect(synthModel.$fxNote.value).toEqual({ envelopes, start: 1, release: null });
      await travel(1);
      onPress([4, 'E']);
      // a key released that is not the last one: nothing
      onRelease([4, 'C']);
      expect(synthModel.$fxNote.value).toEqual({ envelopes, start: 2, release: null });
      await travel(0.5);
      onRelease([4, 'E']);
      expect(synthModel.$fxNote.value).toEqual({ envelopes, start: 2, release: 2.5 });
    });

    it('in legato those of the phrase: not started again by its notes, released with its last key', async () => {
      const { onPress, onRelease, synthModel, synthActions, travel } = await setup();
      synthActions.setLegato(true);
      onPress([4, 'C']);
      const phrase = synthModel.$fxNote.value;
      await travel(1);
      onPress([4, 'E']);
      // a note of the phrase changes nothing: no new value
      expect(synthModel.$fxNote.value).toBe(phrase);
      expect(synthModel.$fxNote.value).toMatchObject({ start: 0, release: null });
      onRelease([4, 'E']);
      expect(synthModel.$fxNote.value?.release).toBeNull();
      await travel(1);
      onRelease([4, 'C']);
      expect(synthModel.$fxNote.value).toMatchObject({ start: 0, release: 2 });
    });

    it('follow a voice processed late from its first sample: its start and its release', async () => {
      const { onPress, onRelease, voices, synthModel, audioCtx, travel, wall } = await setup();
      const rate = audioCtx.sampleRate;
      await travel(1);
      onPress([4, 'C']);
      // its node came 30 ms late: its processor started it there
      voices()[0].port.onmessage?.({ data: { started: Math.round(1.03 * rate), scheduled: rate } });
      expect(synthModel.$fxNote.value?.start).toBeCloseTo(1.03, 6);
      expect(synthModel.$fxNote.value?.release).toBeNull();
      await travel(0.1);
      wall.mockReturnValue(100);
      onRelease([4, 'C']);
      // held 100 ms from its first sample
      expect(synthModel.$fxNote.value?.release).toBeCloseTo(1.13, 6);
    });

    it('released before the late start of its voice is known: the release moves with it', async () => {
      const { onPress, onRelease, voices, synthModel, audioCtx, wall } = await setup();
      onPress([4, 'C']);
      wall.mockReturnValue(4);
      onRelease([4, 'C']);
      expect(synthModel.$fxNote.value?.release).toBe(0.004);
      // its processor started it 30 ms late and sees the gate there: released 4 ms after its first sample
      voices()[0].port.onmessage?.({
        data: { started: Math.round(0.03 * audioCtx.sampleRate), scheduled: 0 },
      });
      expect(synthModel.$fxNote.value?.start).toBeCloseTo(0.03, 6);
      expect(synthModel.$fxNote.value?.release).toBeCloseTo(0.034, 6);
    });

    it('in legato from where the first voice of the phrase started, its notes scheduled as before', async () => {
      const { onPress, voices, options, synthModel, synthActions, audioCtx, travel } = await setup();
      const rate = audioCtx.sampleRate;
      synthActions.setLegato(true);
      onPress([4, 'C']);
      voices()[0].port.onmessage?.({ data: { started: Math.round(0.03 * rate), scheduled: 0 } });
      await travel(1);
      onPress([4, 'E']);
      expect(synthModel.$fxNote.value?.start).toBeCloseTo(0.03, 6);
      // a note of the phrase processed late: its own start, not the phrase's
      voices()[1].port.onmessage?.({ data: { started: Math.round(1.01 * rate), scheduled: rate } });
      expect(synthModel.$fxNote.value?.start).toBeCloseTo(0.03, 6);
      // its processor finds the phrase by its number
      expect(options(voices()[1])).toMatchObject({
        start: 1,
        envStart: 0,
        phrase: options(voices()[0]).phrase,
      });
    });

    it('stay those of the last note when an earlier voice tells it started late', async () => {
      const { onPress, voices, synthModel, envelopeModel, audioCtx, travel } = await setup();
      const { $envelopes } = envelopeModel[0];
      const envelopes = [$envelopes.value.env1, $envelopes.value.env2, $envelopes.value.env3];
      onPress([4, 'C']);
      await travel(1);
      onPress([4, 'E']);
      voices()[0].port.onmessage?.({
        data: { started: Math.round(0.03 * audioCtx.sampleRate), scheduled: 0 },
      });
      expect(synthModel.$fxNote.value).toEqual({ envelopes, start: 1, release: null });
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
