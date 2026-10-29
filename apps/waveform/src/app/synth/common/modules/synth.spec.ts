import { registrar } from 'standardized-audio-context-mock';
import { ENVELOPE_DEFAULTS, PITCH_BEND_DEFAULT, PITCH_BEND_MAX } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createSynth, stopModels } from '../../../../test-utils/models';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { WorkerStub } from '../../../../test-utils/worker-stub';
import { withCurves } from '../../../../test-utils/envelopes';
import { eventsOf, voiceEvents, VoiceView, voicesNodes } from '../../../../test-utils/voice-events';
import { getFq } from '../../services';
import { RELEASE_GATE, VoiceParam } from '../wavetable/wavetable-osc-params';
import { curveShape, envelopeValue } from '../envelope/envelope-curve';
import { UNISON_SHAPE } from '../wavetable/voice-options';
import { glideValue } from './glide';

// the wavetable oscillator loads its module asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));
// the values of the events in f32, as an AudioParam keeps them
const f32 = Math.fround;
// the velocity of the computer keyboard and the piano (100) as a share of 127: VELO on a line, the amp at Amp 1
const KEY = 100 / 127;

const setup = async ({ ready = true } = {}) => {
  const modules = createSynth();
  const [{ audioCtx, preGain, wavetables }] = modules.synthCore;
  const createGain = jest.spyOn(audioCtx, 'createGain');
  const [, { onPress, onRelease }] = modules.inputController;
  const [synthModel, synthActions] = modules.synth;
  if (ready) await flush();

  // the voices the synth made in the voices node, from its events
  const events = voiceEvents(audioCtx, wavetables);
  const { voices, end, started, bends } = events;
  // a param of a voice: its events so far played into an AudioParam mock
  const param = (voice: VoiceView, name: VoiceParam) => {
    voices();
    return voice.params[name];
  };
  const gains = () => createGain.mock.results.map(({ value }) => value as GainNode);
  // the options a voice was made with
  const options = (voice: VoiceView) => voice.options;
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
    started,
    bends,
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
// the calls an event of each kind played into a param (set, target, ramp, cancel: those of an AudioParam)
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
    expect(voice.options).toEqual({
      osc: [{ table: osc1[0].id, unison: 2, phase: 0.5, phaseRand: 1, unisonShape: UNISON_SHAPE }, null],
      start: 0,
      // the knobs with the curves of a fresh envelope
      envelopes: [ENVELOPE_DEFAULTS.env1, ENVELOPE_DEFAULTS.env2, ENVELOPE_DEFAULTS.env3].map(withCurves),
      envStart: 0,
      phrase: expect.any(Number),
      routes: [],
      filter: null,
      velocity: { level: KEY, amp: KEY },
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
    osc2[1].setUnisonShape({ blend: 0.8, stack: '12+7x2' });

    onPress([4, 'A']);

    const [voice] = voices();
    expect((voice.options as { osc: unknown[] }).osc).toEqual([
      { table: osc1[0].id, unison: 2, phase: 0.5, phaseRand: 1, unisonShape: UNISON_SHAPE },
      {
        table: osc2[0].id,
        unison: 4,
        phase: 0.5,
        phaseRand: 1,
        // the shape of its unison as it is at the note on
        unisonShape: { ...UNISON_SHAPE, blend: 0.8, stack: '12+7x2' },
      },
    ]);
    // the octave in cents, the position as a share of the table
    expect(param(voice, 'detune2').value).toBe(-1200);
    expect(param(voice, 'gain2').value).toBe(f32(0.3));
    expect(param(voice, 'position2').value).toBe(0.5);
  });

  it('creates no native oscillators and no gains: the volume is in the processor', async () => {
    const { onPress, audioCtx, gains } = await setup();
    onPress([4, 'A']);
    expect(registrar.getAudioNodes(audioCtx as never, 'OscillatorNode')).toHaveLength(0);
    expect(gains()).toEqual([]);
  });

  it('plays every voice in the voices node, connected straight to the synth output', async () => {
    const { onPress, voices, preGain, audioCtx } = await setup();
    onPress([4, 'A']);
    onPress([4, 'C']);
    const [node] = voicesNodes(audioCtx);
    expect(voicesNodes(audioCtx)).toHaveLength(1);
    expect(node.connect).toHaveBeenCalledWith(preGain);
    expect(voices().map(({ node: of }) => of)).toEqual([node, node]);
  });

  it('sends the events of a task to the voices node in one message, in the order they were made', async () => {
    const { onPress, onRelease, voices, audioCtx, synthActions } = await setup();
    synthActions.setPortamento(100);
    const [node] = voicesNodes(audioCtx);
    // (the LFOs as the node got ready)
    const sent = eventsOf(node).length;
    onPress([4, 'C']);
    onPress([4, 'E']);
    onRelease([4, 'C']);
    // (a microtask sends them)
    expect(eventsOf(node).slice(sent)).toEqual([]);
    await Promise.resolve();
    const [{ events }] = eventsOf(node).slice(sent);
    expect(eventsOf(node).slice(sent)).toHaveLength(1);
    const [c, e] = voices();
    expect(events.map(({ kind }) => kind)).toEqual([
      'on',
      'on',
      // E glides from C: its frequency held at C, then 8 ramps
      'set',
      ...Array(8).fill('ramp'),
      // C released
      'cancel',
      'set',
    ]);
    expect(events[0]).toEqual({
      kind: 'on',
      voice: c.id,
      options: c.options,
      // in f32, as an AudioParam keeps them
      params: {
        frequency: Math.fround(getFq([4, 'C'])),
        position1: 0,
        detune1: 0,
        spread1: 5,
        gain1: 0.5,
        position2: 0,
        detune2: 0,
        spread2: 5,
        gain2: 0.5,
      },
    });
    expect(events[2]).toEqual({
      kind: 'set',
      voice: e.id,
      param: 'frequency',
      value: Math.fround(getFq([4, 'C'])),
      time: 0,
    });
    expect(events.at(-1)).toEqual({ kind: 'set', voice: c.id, param: 'gate', value: RELEASE_GATE, time: 0 });
  });

  it('gives a note the envelopes at its note on, they start with it', async () => {
    const { onPress, voices, options, envelopeModel, travel } = await setup();
    const [{ $envelopes }, { setEnvelopeValue, setEnvelopeCurve }] = envelopeModel;
    setEnvelopeValue('env1', 'attack', 0.1);
    setEnvelopeValue('env2', 'decay', 3);
    setEnvelopeCurve('env2', 'decay', -3);
    await travel(1);

    onPress([4, 'C']);
    const { env1, env2, env3 } = $envelopes.value;
    // an edit changes the next notes only
    setEnvelopeValue('env1', 'sustain', 0.5);
    setEnvelopeCurve('env1', 'release', 1);
    onPress([4, 'E']);

    const [c, e] = voices();
    expect(options(c)).toMatchObject({
      envelopes: [env1, env2, env3],
      envStart: 1,
      start: 1,
    });
    // the curves of the knobs, the default shape unless edited
    expect(options(c).envelopes[1]).toEqual({
      ...env2,
      decay: 3,
      curves: { attack: 0, decay: -3, release: 3.49 },
    });
    expect(options(e).envelopes[0]).toEqual({
      ...env1,
      sustain: 0.5,
      curves: { ...env1.curves, release: 1 },
    });
  });

  it('releases a note: its gate tells the processor now how long its key was held', async () => {
    const { onPress, onRelease, voices, param, synthModel, envelopeModel, travel, end } = await setup();
    envelopeModel[1].setEnvelopeValue('env1', 'release', 0.5);
    onPress([4, 'C']);
    await travel(1);

    onRelease([4, 'C']);

    const [voice] = voices();
    // the key was held 0 ms by the clock of the page: the processor releases it where it sees the gate
    expect(calls(param(voice, 'gate'), 'setValueAtTime')).toEqual([[RELEASE_GATE, 1]]);
    // it sounds until its release is over
    expect(synthModel.$voicesCount.value).toBe(1);
    end(voice);
    expect(synthModel.$voicesCount.value).toBe(0);
  });

  it('releases a note shorter than a step of the context time as long after its start as its key was held', async () => {
    const { onPress, onRelease, voices, param, synthModel, wall } = await setup();
    onPress([4, 'C']);
    // currentTime hasn't moved (it moves by device buffers), the key was held 4 ms
    wall.mockReturnValue(4);
    onRelease([4, 'C']);
    expect(calls(param(voices()[0], 'gate'), 'setValueAtTime')).toEqual([[f32(RELEASE_GATE + 0.004), 0]]);
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

  it('sends a voice that has ended nothing more', async () => {
    const { onPress, onRelease, voices, end, osc1, param } = await setup();
    onPress([4, 'C']);
    onRelease([4, 'C']);
    const [voice] = voices();

    end(voice);
    osc1[1].setGain(0.2);

    expect(calls(param(voice, 'gain1'), 'setTargetAtTime')).toEqual([]);
  });

  it('takes a held voice off when it fails in the node (told ended), the others and new notes play on', async () => {
    const { onPress, onRelease, voices, wavetables, osc1, param, end } = await setup();
    onPress([4, 'C']);
    onPress([4, 'E']);
    const [c, e] = voices();

    end(c);

    expect(wavetables.$status.value).toBe('ready');
    // a voice that ended doesn't follow the knobs, its key releases nothing
    osc1[1].setGain(0.2);
    expect(calls(param(c, 'gain1'), 'setTargetAtTime')).toEqual([]);
    expect(calls(param(e, 'gain1'), 'setTargetAtTime')).toHaveLength(1);
    onRelease([4, 'C']);
    expect(calls(param(c, 'gate'), 'setValueAtTime')).toEqual([]);
    onPress([4, 'G']);
    expect(voices()).toHaveLength(3);
  });

  it('a held voice that failed takes no voice of Poly: the next note steals no voice that plays', async () => {
    const { onPress, voices, param, synthModel, synthActions, end } = await setup();
    synthActions.setMaxVoices(2);
    onPress([4, 'C']);
    onPress([4, 'E']);
    const [c, e] = voices();

    end(c);
    expect(synthModel.$voicesCount.value).toBe(1);

    onPress([4, 'G']);
    expect(calls(param(e, 'gate'), 'setValueAtTime')).toEqual([]);
    expect(synthModel.$voicesCount.value).toBe(2);
  });

  it('ends every voice when the voices node fails: their keys are free, Retry makes the node again', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { onPress, onRelease, voices, wavetables, synthModel, audioCtx } = await setup();
    onPress([4, 'C']);
    onPress([4, 'E']);
    voices();
    const [node] = voicesNodes(audioCtx);

    node.onprocessorerror?.(new Event('processorerror'));

    expect(error).toHaveBeenCalledWith('The wavetable oscillator failed', expect.any(Event));
    expect(wavetables.$status.value).toBe('failed');
    expect(synthModel.$voicesCount.value).toBe(0);
    expect(node.port.postMessage).toHaveBeenCalledWith({ stop: true });
    expect(node.disconnect).toHaveBeenCalled();
    onRelease([4, 'C']);
    wavetables.retry();
    await flush();
    expect(voicesNodes(audioCtx)).toHaveLength(2);
    onPress([4, 'G']);
    expect(voices().map(({ node: of }) => of)).toEqual([node, node, voicesNodes(audioCtx)[1]]);
    expect(synthModel.$voicesCount.value).toBe(1);
    error.mockRestore();
  });

  it('a held voice that ended by itself is no note to glide from', async () => {
    const { onPress, voices, param, synthActions, end } = await setup();
    synthActions.setPortamento(200);
    onPress([4, 'C']);
    onPress([4, 'E']);
    // its process() threw: it posts that it has ended
    end(voices()[1]);

    onPress([4, 'G']);

    const [, , g] = voices();
    expect(calls(param(g, 'frequency'), 'setValueAtTime')).toEqual([[f32(getFq([4, 'C'])), 0]]);
  });

  it('the fx release the envelopes of a held note whose voice ended by itself', async () => {
    const { onPress, voices, synthModel, end, travel } = await setup();
    onPress([4, 'C']);
    await travel(1);
    expect(synthModel.$fxNote.value?.release).toBeNull();

    end(voices()[0]);

    expect(synthModel.$fxNote.value?.release).toBe(1);
    expect(synthModel.$voicesCount.value).toBe(0);
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
      const { onPress, onRelease, voices, param, synthActions, travel, envelopeModel, audioCtx, started } =
        await setup();
      envelopeModel[1].setEnvelopeValue('env1', 'attack', 0);
      envelopeModel[1].setEnvelopeValue('env1', 'release', 1);
      synthActions.setMaxVoices(2);
      onPress([4, 'C']);
      // its processor started it 40 ms late and released it there: its release is over at 1.04
      started(voices()[0], Math.round(0.04 * audioCtx.sampleRate), 0);
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

  it('takes a stolen voice off once it has ended: a preset switch waits for it', async () => {
    const { onPress, voices, end, synthActions, synthModel } = await setup();
    synthActions.setMaxVoices(2);
    onPress([4, 'C']);
    onPress([4, 'E']);
    onPress([4, 'G']);
    const [c] = voices();
    synthModel.voicing.pause();
    const [, e, g] = voices();
    end(e);
    end(g);
    expect(synthModel.voicing.silent).toBe(false);

    end(c);

    expect(synthModel.voicing.silent).toBe(true);
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
    expect(calls(frequency, 'setValueAtTime')).toEqual([[f32(getFq([4, 'C'])), 1]]);
    const ramps = calls(frequency, 'exponentialRampToValueAtTime');
    expect(ramps).toHaveLength(8);
    expect(ramps[7]).toEqual([f32(getFq([4, 'E'])), expect.closeTo(1.2, 9)]);
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
      f32(getFq([4, 'E'])),
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
    // the frequency of a note, in f32 as its events have it
    const fq = (name: 'A' | 'B' | 'C' | 'D') => f32(getFq([4, name]));

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
      const at = glideValue({ from: getFq([4, 'A']), to: getFq([4, 'B']), start: 1, seconds: 0.2 }, 1.05);
      expect(at).toBeGreaterThan(fq('A'));
      expect(calls(frequency, 'setValueAtTime')[1]).toEqual([f32(at), 1.05]);
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
      // the fx: a new note from now, ENV 1 from 0.48 (its release from 1 at 1 s, curved: linear 0.8),
      // ENV 2 and 3 from 0 (decayed)
      const curved = { ...env1, release: 1 };
      expect(synthModel.$fxNote.value).toEqual({
        envelopes: [curved, env2, env3],
        start: expect.closeTo(1.2, 9),
        release: null,
        from: [expect.closeTo(envelopeValue(curved, 1.2, 1), 9), 0, 0],
        velo: KEY,
        velocity: KEY,
      });
      expect(envelopeValue(curved, 1.2, 1)).toBeCloseTo(0.4818, 4);
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
        f32(RELEASE_GATE + 0.3),
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

    it('a new voice for a note that would start other curves than those of its voice', async () => {
      const { onPress, voices, envelopeModel, options } = await mono(100, false);
      onPress([4, 'A']);
      onPress([4, 'B']);
      expect(voices()).toHaveLength(1);
      envelopeModel[1].setEnvelopeCurve('env2', 'attack', 2);
      onPress([4, 'C']);
      const [, c] = voices();
      expect(options(c).envelopes[1].curves).toEqual({ attack: 2, decay: 3.49, release: 3.49 });
    });

    it('a new voice for a note that would play other oscillators than the knobs, a glide keeps it', async () => {
      const { onPress, voices, param, synthActions, osc1, osc2, options } = await mono(100, false);
      const stolen = (index: number) => calls(param(voices()[index], 'gate'), 'setValueAtTime').at(-1)?.[0];
      onPress([4, 'A']);
      // an oscillator turned on
      osc2[1].toggleActive();
      onPress([4, 'B']);
      expect(voices()).toHaveLength(2);
      expect(stolen(0)).toBe(-1);
      expect(options(voices()[1]).osc[1]).not.toBeNull();
      // the unison and its shape
      osc1[1].setOscValue('unison', 4);
      onPress([4, 'C']);
      expect(voices()).toHaveLength(3);
      expect(options(voices()[2]).osc[0]).toMatchObject({ unison: 4 });
      osc2[1].setUnisonShape({ blend: 0.8 });
      onPress([4, 'D']);
      expect(voices()).toHaveLength(4);
      expect(stolen(2)).toBe(-1);
      // the phases only start a voice: taken over, it goes on with them
      osc1[1].setOscValue('phase', 0.2);
      onPress([4, 'E']);
      expect(voices()).toHaveLength(4);
      // in legato its envelopes go on: the voice glides on with its unison
      synthActions.setLegato(true);
      osc1[1].setOscValue('unison', 3);
      onPress([4, 'F']);
      expect(voices()).toHaveLength(4);
      expect(calls(param(voices()[3], 'frequency'), 'exponentialRampToValueAtTime').at(-1)?.[0]).toBe(
        f32(getFq([4, 'F']))
      );
    });

    describe('a voice processed late', () => {
      const late = async () => {
        const context = await mono(0, false);
        context.envelopeModel[1].setEnvelopeValue('env1', 'attack', 0.02);
        context.envelopeModel[1].setEnvelopeValue('env1', 'release', 0.1);
        const { env1, env2, env3 } = context.envelopeModel[0].$envelopes.value;
        const rate = context.audioCtx.sampleRate;
        // its processor tells it started at `seconds` (the frame of the context)
        const started = (seconds: number) => {
          const frame = Math.round(seconds * rate);
          context.started(context.voices()[0], frame, 0);
          return frame / rate;
        };
        return { ...context, envelopes: [env1, env2, env3], started };
      };

      it('started its envelopes again before its first sample: they start there, the fx follow it', async () => {
        const { onPress, synthModel, travel, envelopes, started } = await late();
        onPress([4, 'A']);
        await travel(0.01);
        onPress([4, 'B']);
        expect(synthModel.$fxNote.value?.from?.[0]).toBeCloseTo(envelopeValue(envelopes[0], 0.01), 9);
        // its node came 30 ms late: its processor sees the gate held again at its first sample
        const first = started(0.03);
        expect(synthModel.$fxNote.value).toMatchObject({ start: expect.closeTo(first, 9), release: null });
        expect(synthModel.$fxNote.value?.from).toBeUndefined();
      });

      it('started them again after its first sample, before it was known: from the levels they had there', async () => {
        const { onPress, synthModel, audioCtx, travel, envelopes, started } = await late();
        onPress([4, 'A']);
        await travel(0.01);
        onPress([4, 'B']);
        const again = audioCtx.currentTime;
        const first = started(0.005);
        expect(synthModel.$fxNote.value).toMatchObject({
          start: expect.closeTo(again, 9),
          from: envelopes.map((env) => expect.closeTo(envelopeValue(env, again - first), 9)),
        });
        expect(synthModel.$fxNote.value?.from?.[0]).toBeLessThan(envelopeValue(envelopes[0], again));
      });

      it('released, then started again from its release: the release from its first sample', async () => {
        const { onPress, onRelease, synthModel, audioCtx, travel, wall, envelopes, started } = await late();
        onPress([4, 'A']);
        wall.mockReturnValue(4);
        onRelease([4, 'A']);
        await travel(0.01);
        onPress([4, 'B']);
        const again = audioCtx.currentTime;
        // held 4 ms from its first sample
        const first = started(0.005);
        expect(synthModel.$fxNote.value?.from).toEqual(
          envelopes.map((env) => expect.closeTo(envelopeValue(env, again - first, 0.004), 9))
        );
      });

      it('a start on time after a start again changes nothing', async () => {
        const { onPress, synthModel, travel, voices, started } = await late();
        onPress([4, 'A']);
        // its processor tells its start, on time too
        expect(voices()[0].options).toMatchObject({ mono: true });
        await travel(0.01);
        onPress([4, 'B']);
        const note = synthModel.$fxNote.value;
        started(0);
        expect(synthModel.$fxNote.value).toBe(note);
      });
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

      expect(calls(param(voice, 'gain1'), 'setTargetAtTime')).toEqual([[f32(0.1), now, expect.any(Number)]]);
      expect(calls(param(voice, 'spread1'), 'setTargetAtTime')).toEqual([[30, now, expect.any(Number)]]);
      expect(calls(param(voice, 'position1'), 'setTargetAtTime')).toEqual([[1, now, expect.any(Number)]]);
      expect(calls(param(voice, 'detune1'), 'setTargetAtTime')).toEqual([]);
      expect(calls(param(voice, 'detune1'), 'setValueAtTime').at(-1)).toEqual([1200, now]);
    });

    it('Semi and Fine are set at once, on top of the octave, released notes too', async () => {
      const { onPress, onRelease, voices, param, osc1, osc2, audioCtx } = await setup();
      osc2[1].toggleActive();
      onPress([4, 'C']);
      onRelease([4, 'C']);
      onPress([4, 'E']);
      const now = audioCtx.currentTime;

      osc2[1].setOscValue('semi', 7);
      osc2[1].setOscValue('fine', -7);
      osc1[1].setOscValue('octave', -1);
      osc1[1].setOscValue('fine', 12);

      voices().forEach((voice) => {
        expect(calls(param(voice, 'detune2'), 'setTargetAtTime')).toEqual([]);
        expect(calls(param(voice, 'detune2'), 'setValueAtTime')).toEqual([
          [700, now],
          [693, now],
        ]);
        expect(calls(param(voice, 'detune1'), 'setValueAtTime').at(-1)).toEqual([-1188, now]);
      });
    });

    it('a glide settles exactly within about 20 ms, a newer value cancels it', async () => {
      const { onPress, voices, param, osc1, travel } = await setup();
      onPress([4, 'C']);
      const [voice] = voices();
      osc1[1].setGain(0.1);
      const gain = param(voice, 'gain1');
      const [[, settle]] = calls(gain, 'setValueAtTime').filter(([value]) => value === f32(0.1));
      expect(settle).toBeGreaterThan(0.01);
      expect(settle).toBeLessThan(0.03);

      osc1[1].setGain(0.2);
      expect(param(voice, 'gain1').cancelScheduledValues).toHaveBeenLastCalledWith(0);
      await travel(0.1);
      expect(gain.value).toBeCloseTo(0.2, 5);
    });

    it('the voices of the second oscillator follow its knobs', async () => {
      const { onPress, voices, param, osc2 } = await setup();
      onPress([4, 'C']);
      const [voice] = voices();
      osc2[1].setGain(0.9);
      expect(calls(param(voice, 'gain2'), 'setTargetAtTime')).toEqual([[f32(0.9), 0, expect.any(Number)]]);
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
      expect((voice.options as { osc: unknown[] }).osc).toEqual([
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
      expect(JSON.stringify(voice.options).length).toBeLessThan(1024);
    });

    it('unison and on/off take effect on new notes only', async () => {
      const { onPress, voices, osc1, osc2 } = await setup();
      onPress([4, 'C']);
      osc1[1].setOscValue('unison', 7);
      osc2[1].toggleActive();
      onPress([4, 'E']);
      const [first, second] = voices().map(
        (voice) => (voice.options as { osc: ({ unison: number } | null)[] }).osc
      );
      expect(first[0]?.unison).toBe(2);
      expect(first[1]).toBeNull();
      expect(second[0]?.unison).toBe(7);
      expect(second[1]).not.toBeNull();
    });
  });

  describe('pitch bend', () => {
    afterEach(() => jest.useRealTimers());

    it('bends every note in the voices node, one event for them all: no automation of their detunes', async () => {
      const { onPress, onRelease, voices, param, inputController, bends } = await setup();
      const [, { setBend }] = inputController;
      onPress([4, 'C']);
      onPress([4, 'E']);
      onRelease([4, 'E']);

      setBend(1);

      expect(bends()).toEqual([200]);
      voices().forEach((voice) => {
        expect(calls(param(voice, 'detune1'), 'setTargetAtTime')).toEqual([]);
        expect(calls(param(voice, 'detune1'), 'setValueAtTime')).toEqual([]);
      });
      // a new note: its detune is its octave, the node bends it
      onPress([4, 'G']);
      expect(voices()[2].values.detune1).toBe(0);
    });

    it('an octave changed while bent steps the detune to the octave alone', async () => {
      const { onPress, voices, param, inputController, osc1, audioCtx } = await setup();
      inputController[1].setBend(-0.5);
      onPress([4, 'C']);
      const [voice] = voices();
      expect(voice.values.detune1).toBe(0);

      osc1[1].setOscValue('octave', 1);
      expect(calls(param(voice, 'detune1'), 'setValueAtTime').at(-1)).toEqual([1200, audioCtx.currentTime]);
      expect(calls(param(voice, 'detune1'), 'setTargetAtTime')).toEqual([]);
    });

    it('moves the notes by its range down and up, each its own', async () => {
      const { inputController, synthActions, bends } = await setup();
      synthActions.setBendDown(12);
      synthActions.setBendUp(7);
      jest.useFakeTimers();
      inputController[1].setBend(-1);
      jest.advanceTimersByTime(5);
      inputController[1].setBend(1);
      jest.advanceTimersByTime(5);
      inputController[1].setBend(0.5);
      expect(bends()).toEqual([-1200, 700, 350]);
    });

    it('goes to the node at most every 5 ms: the first value at once, the last one after the pause', async () => {
      const { inputController, bends } = await setup();
      jest.useFakeTimers();
      const [, { setBend }] = inputController;

      setBend(0.25);
      setBend(0.5);
      setBend(0.75);
      expect(bends()).toEqual([50]);

      jest.advanceTimersByTime(5);
      expect(bends()).toEqual([50, 150]);
      jest.advanceTimersByTime(20);
      expect(bends()).toEqual([50, 150]);
    });

    it('a range changed while bent moves the notes too', async () => {
      const { inputController, synthActions, bends } = await setup();
      jest.useFakeTimers();
      inputController[1].setBend(1);
      jest.advanceTimersByTime(5);
      synthActions.setBendUp(12);
      expect(bends()).toEqual([200, 1200]);
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
        { source: 1, param: 'position1', amount: 0.5, min: 0, max: 1 },
        { source: 0, param: 'spread1', amount: -25, min: 0, max: 100 },
      ]);
    });

    it('gives a note the routes of the pitch in cents on the detune, within ±12000; none of an oscillator off', async () => {
      const { onPress, voices, options, modulation, osc2 } = await setup();
      const [, { addRoute }] = modulation;
      // Pitch ±48 semitones at ±1, Fine ±100 cents
      addRoute('env2', 'osc1.pitch', 0.75);
      addRoute('velo', 'osc1.fine', -0.25);
      addRoute('env3', 'osc2.pitch', 1);
      expect(osc2[0].$active.value).toBe(false);

      onPress([4, 'C']);

      expect(options(voices()[0]).routes).toEqual([
        { source: 1, param: 'detune1', amount: 3600, min: -12000, max: 12000 },
        { source: 3, param: 'detune1', amount: -25, min: -12000, max: 12000 },
      ]);
    });

    it('gives a source on Pitch and Fine as one route of their cents, of another polarity as two', async () => {
      const { onPress, voices, options, modulation, osc2 } = await setup();
      const [, { addRoute, setPolarity, setAmount }] = modulation;
      osc2[1].toggleActive();
      addRoute('env2', 'osc1.pitch', 0.25);
      addRoute('env2', 'osc1.fine', 0.5);
      addRoute('lfo1', 'osc2.pitch', 0.5);
      addRoute('lfo1', 'osc2.fine', 0.1);
      setPolarity('lfo1', 'osc2.fine', false);
      // cancelled out: no route
      addRoute('env3', 'osc2.pitch', 1 / 48);
      addRoute('env3', 'osc2.fine', -1);

      onPress([4, 'C']);

      const range = { min: -12000, max: 12000 };
      expect(options(voices()[0]).routes).toEqual([
        { source: 1, param: 'detune1', amount: 1250, ...range },
        { source: 4, param: 'detune2', amount: 2400, ...range, bipolar: true },
        { source: 4, param: 'detune2', amount: 10, ...range },
      ]);

      // one of them changed on the note: the route of their sum
      const [voice] = voices();
      setAmount('env2', 'osc1.fine', 0);
      expect(
        voices()
          .find(({ id }) => id === voice.id)
          ?.messages.at(-1)
      ).toEqual({
        routes: [
          { source: 1, param: 'detune1', amount: 1200, ...range },
          { source: 4, param: 'detune2', amount: 2400, ...range, bipolar: true },
          { source: 4, param: 'detune2', amount: 10, ...range },
        ],
      });
    });

    it('gives a note the routes of the LFOs (sources 4–7, bipolar ones so) and to the knobs of the LFOs', async () => {
      const { onPress, voices, options, modulation } = await setup();
      const [, { addRoute, setPolarity }] = modulation;
      addRoute('lfo1', 'osc1.wave', 0.5);
      addRoute('lfo4', 'osc1.gain', -0.5);
      setPolarity('lfo4', 'osc1.gain', true);
      // Rate by its frequency in octaves, the times by the share of their travel, Phase in a share of the cycle
      addRoute('env2', 'lfo1.rate', 0.5);
      addRoute('velo', 'lfo3.delay', 0.25);
      addRoute('env3', 'lfo2.phase', -0.5);

      onPress([4, 'C']);

      expect(options(voices()[0]).routes).toEqual([
        { source: 4, param: 'position1', amount: 0.5, min: 0, max: 1 },
        { source: 7, param: 'gain1', amount: -0.5, min: 0, max: 1, bipolar: true },
        { source: 1, param: 'lfo1.rate', amount: 0.5 * Math.log2(3200), min: 1 / 32, max: 100, scale: 'log' },
        { source: 3, param: 'lfo3.delay', amount: 0.25, min: 0, max: 32, scale: 'pow' },
        { source: 2, param: 'lfo2.phase', amount: -0.5, min: 0, max: 1 },
      ]);
    });

    it('sends the playing notes, the released ones too, their new routes; nothing when theirs are the same', async () => {
      const { onPress, onRelease, voices, modulation, osc2, end } = await setup();
      const [, { addRoute, setAmount, removeRoute }] = modulation;
      onPress([4, 'C']);
      onPress([4, 'E']);
      onRelease([4, 'E']);
      const [c, e] = voices();
      const posted = (voice: VoiceView) => voices().find(({ id }) => id === voice.id)?.messages;

      addRoute('env2', 'osc1.gain');
      setAmount('env2', 'osc1.gain', -1);
      // the knob of an oscillator off for the notes
      addRoute('env2', 'osc2.gain');
      expect(osc2[0].$active.value).toBe(false);
      end(e);
      removeRoute('env2', 'osc1.gain');

      const route = { source: 1, param: 'gain1', min: 0, max: 1 };
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

  it('sends the new routes of the voices that have the same ones, and the filter of them all, in one event', async () => {
    const { onPress, voices, modulation, filter, audioCtx } = await setup();
    onPress([4, 'C']);
    onPress([4, 'E']);
    const [c, e] = voices();
    modulation[1].addRoute('env2', 'osc1.gain');
    filter[1].toggleActive();
    await Promise.resolve();
    const events = eventsOf(voicesNodes(audioCtx)[0]).flatMap((message) => message.events);
    expect(events.filter(({ kind }) => kind === 'routes')).toEqual([
      { kind: 'routes', voices: [c.id, e.id], routes: [expect.objectContaining({ param: 'gain1' })] },
    ]);
    expect(events.filter(({ kind }) => kind === 'filter')).toEqual([
      { kind: 'filter', voices: [c.id, e.id], filter: expect.objectContaining({ type: 'lowpass' }) },
    ]);
  });

  describe('filter', () => {
    const posted = (voice: VoiceView) => voice.messages;

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
          source: 1,
          param: 'cutoff',
          amount: expect.closeTo(0.5 * Math.log2(22050 / 10), 9),
          min: 10,
          max: 22050,
          scale: 'log',
        },
        { source: 2, param: 'resonance', amount: -20, min: 0, max: 20 },
      ]);
    });

    it('sends the routes again when the type changes the range of a knob', async () => {
      const { onPress, voices, filter, modulation } = await setup();
      const [, { toggleActive, setType }] = filter;
      toggleActive();
      // (bipolar: the gain is centered on 0)
      modulation[1].addRoute('env2', 'filter.gain', 0.5);
      onPress([4, 'C']);
      setType('lowshelf');

      const [voice] = voices();
      expect(posted(voice).at(-1)).toEqual({
        routes: [{ source: 1, param: 'gain', amount: 40, min: -40, max: 40, bipolar: true }],
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
      const velocity = { velo: KEY, velocity: KEY };
      expect(synthModel.$fxNote.value).toEqual({ envelopes, start: 1, release: null, ...velocity });
      await travel(1);
      onPress([4, 'E']);
      // a key released that is not the last one: nothing
      onRelease([4, 'C']);
      expect(synthModel.$fxNote.value).toEqual({ envelopes, start: 2, release: null, ...velocity });
      await travel(0.5);
      onRelease([4, 'E']);
      expect(synthModel.$fxNote.value).toEqual({ envelopes, start: 2, release: 2.5, ...velocity });
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
      const { onPress, onRelease, voices, synthModel, audioCtx, travel, wall, started } = await setup();
      const rate = audioCtx.sampleRate;
      await travel(1);
      onPress([4, 'C']);
      // its node came 30 ms late: its processor started it there
      started(voices()[0], Math.round(1.03 * rate), rate);
      expect(synthModel.$fxNote.value?.start).toBeCloseTo(1.03, 6);
      expect(synthModel.$fxNote.value?.release).toBeNull();
      await travel(0.1);
      wall.mockReturnValue(100);
      onRelease([4, 'C']);
      // held 100 ms from its first sample
      expect(synthModel.$fxNote.value?.release).toBeCloseTo(1.13, 6);
    });

    it('released before the late start of its voice is known: the release moves with it', async () => {
      const { onPress, onRelease, voices, synthModel, audioCtx, wall, started } = await setup();
      onPress([4, 'C']);
      wall.mockReturnValue(4);
      onRelease([4, 'C']);
      expect(synthModel.$fxNote.value?.release).toBe(0.004);
      // its processor started it 30 ms late and sees the gate there: released 4 ms after its first sample
      started(voices()[0], Math.round(0.03 * audioCtx.sampleRate), 0);
      expect(synthModel.$fxNote.value?.start).toBeCloseTo(0.03, 6);
      expect(synthModel.$fxNote.value?.release).toBeCloseTo(0.034, 6);
    });

    it('in legato from where the first voice of the phrase started, its notes scheduled as before', async () => {
      const { onPress, voices, options, synthModel, synthActions, audioCtx, travel, started } = await setup();
      const rate = audioCtx.sampleRate;
      synthActions.setLegato(true);
      onPress([4, 'C']);
      started(voices()[0], Math.round(0.03 * rate), 0);
      await travel(1);
      onPress([4, 'E']);
      expect(synthModel.$fxNote.value?.start).toBeCloseTo(0.03, 6);
      // a note of the phrase processed late: its own start, not the phrase's
      started(voices()[1], Math.round(1.01 * rate), rate);
      expect(synthModel.$fxNote.value?.start).toBeCloseTo(0.03, 6);
      // its processor finds the phrase by its number
      expect(options(voices()[1])).toMatchObject({
        start: 1,
        envStart: 0,
        phrase: options(voices()[0]).phrase,
      });
    });

    it('stay those of the last note when an earlier voice tells it started late', async () => {
      const { onPress, voices, synthModel, envelopeModel, audioCtx, travel, started } = await setup();
      const { $envelopes } = envelopeModel[0];
      const envelopes = [$envelopes.value.env1, $envelopes.value.env2, $envelopes.value.env3];
      onPress([4, 'C']);
      await travel(1);
      onPress([4, 'E']);
      started(voices()[0], Math.round(0.03 * audioCtx.sampleRate), 0);
      expect(synthModel.$fxNote.value).toEqual({
        envelopes,
        start: 1,
        release: null,
        velo: KEY,
        velocity: KEY,
      });
    });
  });

  describe('velocity', () => {
    // the options of the velocity of a voice
    const velocityOf = (voice: VoiceView) => voice.options.velocity;
    // the velocities a voice was sent (mono)
    const sent = (voice: VoiceView) =>
      voice.messages.flatMap((message) => ('velocity' in message ? [message.velocity] : []));

    it('plays a note at its velocity: VELO by the curve, the amp by Amp (1: VELO itself)', async () => {
      const { onPress, voices, envelopeModel } = await setup();
      onPress([4, 'C'], 64);
      expect(velocityOf(voices()[0])).toEqual({ level: 64 / 127, amp: 64 / 127 });

      envelopeModel[1].setVelocity('amp', 0.5);
      envelopeModel[1].setVelocity('k', 2);
      onPress([4, 'E'], 127);
      onPress([4, 'G'], 32);
      const level = curveShape(2, 32 / 127);
      expect(velocityOf(voices()[1])).toEqual({ level: 1, amp: 1 });
      expect(velocityOf(voices()[2])).toEqual({ level, amp: 0.5 + 0.5 * level });
    });

    it('at Amp 0 every note is at its full volume, VELO still moves the knobs', async () => {
      const { onPress, voices, envelopeModel, modulation } = await setup();
      envelopeModel[1].setVelocity('amp', 0);
      modulation[1].addRoute('velo', 'osc1.wave');
      onPress([4, 'C'], 10);
      const [voice] = voices();
      expect(velocityOf(voice)).toEqual({ level: 10 / 127, amp: 1 });
      // the source after the envelopes
      expect(voice.options.routes).toEqual([expect.objectContaining({ source: 3, param: 'position1' })]);
    });

    it('the notes of a legato phrase each have their own, the fx follow the last one', async () => {
      const { onPress, voices, synthModel, synthActions } = await setup();
      synthActions.setLegato(true);
      onPress([4, 'C'], 30);
      onPress([4, 'E'], 120);
      expect(voices().map((voice) => velocityOf(voice)?.level)).toEqual([30 / 127, 120 / 127]);
      expect(synthModel.$fxNote.value).toMatchObject({ velo: 120 / 127, velocity: 120 / 127 });
    });

    it('mono: a note that takes the voice over sends its velocity, the key below gets its own back', async () => {
      const { onPress, onRelease, voices, synthModel, synthActions } = await setup();
      synthActions.setMaxVoices(1);
      synthActions.setLegato(true);
      onPress([4, 'C'], 30);
      onPress([4, 'E'], 90);
      expect(voices()).toHaveLength(1);
      const [voice] = voices();
      expect(velocityOf(voice)).toEqual({ level: 30 / 127, amp: 30 / 127 });
      expect(sent(voice)).toEqual([{ level: 90 / 127, amp: 90 / 127 }]);
      // the fx too, though in legato no new note starts them
      expect(synthModel.$fxNote.value).toMatchObject({ velo: 90 / 127, velocity: 90 / 127 });

      onRelease([4, 'E']);
      expect(sent(voices()[0])).toEqual([
        { level: 90 / 127, amp: 90 / 127 },
        { level: 30 / 127, amp: 30 / 127 },
      ]);
      // the same velocity again: nothing sent
      onPress([4, 'D'], 30);
      expect(sent(voices()[0])).toHaveLength(2);
    });

    it('a preset switch: the keys wait with their velocities and start at them', async () => {
      const { onPress, voices, synthActions, end } = await setup();
      onPress([4, 'C'], 20);
      synthActions.pause();
      voices().forEach(end);
      onPress([4, 'E'], 110);
      synthActions.resume();
      expect(
        voices()
          .slice(1)
          .map((voice) => velocityOf(voice)?.level)
      ).toEqual([20 / 127, 110 / 127]);
    });

    it('steals the quietest released voice by ENV 1 × its amp: a soft note before a loud one', async () => {
      const { onPress, onRelease, voices, param, synthActions, envelopeModel, travel } = await setup();
      synthActions.setMaxVoices(2);
      envelopeModel[1].setEnvelopeValue('env1', 'release', 2);
      onPress([4, 'C'], 127);
      onPress([4, 'E'], 10);
      await travel(0.5);
      onRelease([4, 'E']);
      onRelease([4, 'C']);
      onPress([4, 'G']);
      const [loud, soft] = voices();
      expect(calls(param(soft, 'gate'), 'setValueAtTime').at(-1)?.[0]).toBe(-1);
      expect(calls(param(loud, 'gate'), 'setValueAtTime').at(-1)?.[0]).toBeGreaterThanOrEqual(RELEASE_GATE);
    });
  });

  describe('a preset switch: pause and resume', () => {
    // the frequency of a note, in f32 as its events have it
    const fq = (name: 'A' | 'B' | 'C' | 'E' | 'G') => f32(getFq([4, name]));

    it('pause fades every voice out, held and released ones, the fx follow no note', async () => {
      const { onPress, onRelease, voices, param, synthModel, synthActions, travel } = await setup();
      onPress([4, 'C']);
      onPress([4, 'E']);
      onRelease([4, 'E']);
      await travel(1);

      synthActions.pause();

      voices().forEach((voice) =>
        expect(calls(param(voice, 'gate'), 'setValueAtTime').at(-1)).toEqual([-1, 1])
      );
      expect(synthModel.$voicesCount.value).toBe(0);
      expect(synthModel.$fxNote.value).toBeNull();
    });

    it('a key pressed or released while paused makes no voice and releases nothing', async () => {
      const { onPress, onRelease, voices, param, synthActions } = await setup();
      onPress([4, 'C']);
      synthActions.pause();
      const gates = calls(param(voices()[0], 'gate'), 'setValueAtTime').length;
      onPress([4, 'E']);
      onRelease([4, 'C']);
      expect(voices()).toHaveLength(1);
      expect(calls(param(voices()[0], 'gate'), 'setValueAtTime')).toHaveLength(gates);
    });

    it('resume starts the keys still held and those pressed meanwhile, in their order, with no glide', async () => {
      const { onPress, onRelease, voices, param, synthModel, synthActions, end } = await setup();
      synthActions.setPortamento(200);
      onPress([4, 'C']);
      onPress([4, 'E']);
      synthActions.pause();
      voices().forEach(end);
      onRelease([4, 'C']);
      onPress([4, 'G']);

      synthActions.resume();

      const started = voices().slice(2);
      expect(started.map((voice) => param(voice, 'frequency').value)).toEqual([fq('E'), fq('G')]);
      started.forEach((voice) =>
        expect(calls(param(voice, 'frequency'), 'exponentialRampToValueAtTime')).toEqual([])
      );
      expect(synthModel.$voicesCount.value).toBe(2);
      expect(synthModel.$fxNote.value).not.toBeNull();
      // they play on as any note: released by their keys
      onRelease([4, 'G']);
      expect(calls(param(started[1], 'gate'), 'setValueAtTime').at(-1)?.[0]).toBeGreaterThanOrEqual(
        RELEASE_GATE
      );
      expect(synthModel.$voicesCount.value).toBe(2);
    });

    it('resume plays the mode of the next preset: in mono the last key pressed, the keys under it in its stack', async () => {
      const { onPress, onRelease, voices, param, synthActions } = await setup();
      onPress([4, 'A']);
      onPress([4, 'B']);
      synthActions.pause();
      synthActions.setMaxVoices(1);
      synthActions.setPortamento(0);

      synthActions.resume();

      expect(voices()).toHaveLength(3);
      const voice = voices()[2];
      expect(param(voice, 'frequency').value).toBe(fq('B'));
      // the key on top released: the key under it takes the voice over
      onRelease([4, 'B']);
      expect(voices()).toHaveLength(3);
      expect(calls(param(voice, 'frequency'), 'setValueAtTime').at(-1)).toEqual([fq('A'), 0]);
    });

    it('a mono voice paused: its stack waits, in its order', async () => {
      const { onPress, voices, param, synthActions } = await setup();
      synthActions.setMaxVoices(1);
      onPress([4, 'B']);
      onPress([4, 'A']);
      synthActions.pause();
      synthActions.resume();
      expect(voices()).toHaveLength(2);
      expect(param(voices()[1], 'frequency').value).toBe(fq('A'));
    });

    it('resume plays nothing before the oscillator is ready, the next notes play once it is', async () => {
      const { onPress, voices, synthActions } = await setup({ ready: false });
      synthActions.pause();
      onPress([4, 'C']);
      synthActions.resume();
      expect(voices()).toHaveLength(0);
      await flush();
      onPress([4, 'E']);
      expect(voices()).toHaveLength(1);
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
      expect(voices()[0].options).not.toHaveProperty('trace');
      // out of mono it tells its start only when late
      expect(voices()[0].options).not.toHaveProperty('mono');
    });

    it('traces the voices while observed: their starts come with their note', async () => {
      const { onPress, voices, synthModel, end, started } = await setup();
      const starts: unknown[] = [];
      const subscription = synthModel.$voiceStarts.subscribe((start) => starts.push(start));
      onPress([4, 'A']);
      const [voice] = voices();
      expect(voice.options).toMatchObject({ trace: true });
      started(voice, 140, 0);
      expect(starts).toEqual([{ note: 'A4', scheduled: 0, started: 140 }]);
      // a start doesn't end the voice, the end still does
      expect(synthModel.voicing.silent).toBe(false);
      end(voice);
      expect(synthModel.voicing.silent).toBe(true);

      subscription.unsubscribe();
      onPress([4, 'C']);
      expect(voices()[1].options).not.toHaveProperty('trace');
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
      synthActions.setBendDown(12);
      expect(getSnapshot()['v']).toEqual({ leg: true, port: 120, max: 4, bd: 12, bu: 2 });
    });

    it('applies falsy values and keeps settings missing in the snapshot', async () => {
      const { synthModel, synthActions } = await setup();
      synthActions.setLegato(true);
      synthActions.setPortamento(120);
      synthActions.setMaxVoices(4);

      synthActions.setBendUp(7);

      applySnapshot({ v: { leg: false, port: 0, bd: 0 } });

      expect(synthModel.$legato.value).toBe(false);
      expect(synthModel.$portamento.value).toBe(0);
      expect(synthModel.$maxVoices.value).toBe(4);
      expect(synthModel.$bendDown.value).toBe(0);
      expect(synthModel.$bendUp.value).toBe(7);
    });

    it('puts the bend range of a url snapshot in whole semitones within its range, else its default', async () => {
      const { synthModel } = await setup();
      // a url snapshot skips presetDataSchema (?v-bd=1e400 is Infinity): a bend of NaN cents would silence the synth
      applySnapshot({ v: { bd: Infinity, bu: 'x' as never } });
      expect(synthModel.$bendDown.value).toBe(PITCH_BEND_MAX);
      expect(synthModel.$bendUp.value).toBe(PITCH_BEND_DEFAULT);
      applySnapshot({ v: { bd: 7.4, bu: -3 } });
      expect(synthModel.$bendDown.value).toBe(7);
      expect(synthModel.$bendUp.value).toBe(0);
      applySnapshot({ v: { bd: null as never } });
      expect(synthModel.$bendDown.value).toBe(PITCH_BEND_DEFAULT);
    });
  });
});
