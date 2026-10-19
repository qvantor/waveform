import { registrar } from 'standardized-audio-context-mock';
import { Note } from '@waveform/ui-kit';
import { createSynth } from '../../../../test-utils/models';
import { isOff, work } from '../../../../test-utils/audio-work';
import { seeded } from '../../../../test-utils/voice-dsp';
import { VOICE_PROCESSOR } from '../wavetable/wavetable-osc-params';

// the work of the main thread per note, as exact counts of the audio graph (it replaces the browser suite's
// budget of a note on and its trills): a note on creates its node and its envelope, connects them and
// schedules the envelope; the counts don't grow with the notes held, and every node is off the graph once
// its voice has ended

interface VoiceNode extends AudioWorkletNode {
  name: string;
  port: AudioWorkletNode['port'] & { onmessage: ((event: { data: unknown }) => void) | null };
}

// the wavetable oscillator loads its module asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));

const NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// the n-th note of a run up from C3
const note = (n: number): Note => [3 + Math.floor(n / NOTES.length), NOTES[n % NOTES.length]] as Note;

const setup = async () => {
  const modules = createSynth();
  const [{ audioCtx, preGain }] = modules.synthCore;
  const [, { onPress, onRelease }] = modules.inputController;
  const [, synthActions] = modules.synth;
  await flush();
  const voices = () =>
    (
      registrar.getAudioNodes(audioCtx as never, 'AudioWorkletNode' as never) as unknown as VoiceNode[]
    ).filter(({ name }) => name === VOICE_PROCESSOR);
  // the processor of a voice tells its node it has ended
  const end = (voice: VoiceNode) => voice.port.onmessage?.({ data: { ended: true } });
  const measure = (operation: () => void) => work(audioCtx, operation);
  return { ...modules, audioCtx, preGain, onPress, onRelease, synthActions, voices, end, measure };
};

describe('the work of a note on the main thread', () => {
  it('a note: its node and its envelope, connected, the envelope scheduled', async () => {
    const { onPress, measure } = await setup();
    expect(measure(() => onPress(note(0)))).toEqual({ nodes: 2, connects: 2, disconnects: 0, automation: 5 });
  });

  it('a note while another is held also glides its pitch from it (even at portamento 0)', async () => {
    const { onPress, measure } = await setup();
    onPress(note(0));
    expect(measure(() => onPress(note(1)))).toEqual({ nodes: 2, connects: 2, disconnects: 0, automation: 7 });
  });

  it('a note connects the mod bus of each param a source plays into', async () => {
    const { onPress, measure, osc1, audioCtx } = await setup();
    osc1[1].connectBus('position', audioCtx.createGain());
    osc1[1].connectBus('gain', audioCtx.createGain());
    expect(measure(() => onPress(note(0)))).toEqual({ nodes: 2, connects: 4, disconnects: 0, automation: 5 });
  });

  it('a note over the polyphony fades the oldest voice out', async () => {
    const { onPress, synthActions, measure } = await setup();
    synthActions.setMaxVoices(1);
    onPress(note(0));
    // the stolen voice: its gate to -1 (2), its envelope released (3); the new one doesn't glide (none held)
    expect(measure(() => onPress(note(1)))).toEqual({
      nodes: 2,
      connects: 2,
      disconnects: 0,
      automation: 10,
    });
  });

  it('a note off closes the gate at the end of the release and releases the envelope', async () => {
    const { onPress, onRelease, measure } = await setup();
    onPress(note(0));
    expect(measure(() => onRelease(note(0)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 6,
    });
  });

  it('legato: the first note adds the shared envelope, the next ones only their nodes', async () => {
    const { onPress, onRelease, synthActions, measure } = await setup();
    synthActions.setLegato(true);
    expect(measure(() => onPress(note(0)))).toEqual({ nodes: 3, connects: 3, disconnects: 0, automation: 5 });
    expect(measure(() => onPress(note(1)))).toEqual({ nodes: 2, connects: 2, disconnects: 0, automation: 0 });
    expect(measure(() => onRelease(note(1)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 6,
    });
    // the last one also releases the shared envelope
    expect(measure(() => onRelease(note(0)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 9,
    });
  });

  it('a chord of 12 at Poly 8 (in one task): 4 voices stolen as they start; its release', async () => {
    const { onPress, onRelease, measure } = await setup();
    const chord = Array.from({ length: 12 }, (_, i) => note(i));
    // 5 + 7 · 7 for the first 8, then 4 × (a steal 5 + a note 7)
    expect(measure(() => chord.forEach((n) => onPress(n)))).toEqual({
      nodes: 24,
      connects: 24,
      disconnects: 0,
      automation: 102,
    });
    // the 8 voices held
    expect(measure(() => chord.forEach((n) => onRelease(n)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 48,
    });
  });

  it('the work of a note does not grow with the notes held', async () => {
    const { onPress, synthActions, measure } = await setup();
    synthActions.setMaxVoices(16);
    onPress(note(0));
    const each = Array.from({ length: 15 }, (_, i) => measure(() => onPress(note(i + 1))));
    each.forEach((cost) => expect(cost).toEqual({ nodes: 2, connects: 2, disconnects: 0, automation: 7 }));
  });

  it('an ended voice takes its node, its envelope and its buses off the graph', async () => {
    const { onPress, onRelease, voices, end, measure, osc1, audioCtx } = await setup();
    osc1[1].connectBus('position', audioCtx.createGain());
    onPress(note(0));
    onRelease(note(0));
    const [voice] = voices();
    expect(measure(() => end(voice))).toEqual({ nodes: 0, connects: 0, disconnects: 3, automation: 0 });
    expect(isOff(voice)).toBe(true);
  });

  it('after many notes, steals and legato phrases, every ended voice is off the graph', async () => {
    const { onPress, onRelease, synthActions, voices, end, osc1, audioCtx } = await setup();
    osc1[1].connectBus('detune', audioCtx.createGain());
    // the envelopes and the legato gains of the voices
    const createGain = jest.spyOn(audioCtx, 'createGain');
    const random = seeded(7);
    for (let cycle = 0; cycle < 50; cycle++) {
      synthActions.setLegato(random() < 0.3);
      synthActions.setMaxVoices(random() < 0.5 ? 4 : 8);
      const chord = Array.from({ length: 2 + Math.floor(random() * 10) }, (_, i) => note(i));
      chord.forEach((n) => onPress(n));
      chord.forEach((n) => onRelease(n));
      voices().forEach(end);
    }
    expect(voices().length).toBeGreaterThan(250);
    voices().forEach((voice) => expect(isOff(voice)).toBe(true));
    const gains = createGain.mock.results.map(({ value }) => value as GainNode);
    expect(gains.length).toBeGreaterThanOrEqual(voices().length);
    gains.forEach((gain) => expect(isOff(gain)).toBe(true));
    // the bus: disconnected from every param it was connected to
    const bus = osc1[0].buses.detune as unknown as Record<'connect' | 'disconnect', jest.Mock>;
    expect(bus.connect.mock.calls.length).toBeGreaterThan(0);
    expect(bus.disconnect.mock.calls.length).toBe(bus.connect.mock.calls.length);
    // no voice is left following the knobs
    expect(work(audioCtx, () => osc1[1].setGain(0.3)).automation).toBe(0);
  });
});
