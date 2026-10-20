import { registrar } from 'standardized-audio-context-mock';
import { Note } from '@waveform/ui-kit';
import { createSynth } from '../../../../test-utils/models';
import { isOff, work } from '../../../../test-utils/audio-work';
import { seeded } from '../../../../test-utils/voice-dsp';
import { VOICE_PROCESSOR } from '../wavetable/wavetable-osc-params';

// the work of the main thread per note, as exact counts of the audio graph (it replaces the browser suite's
// budget of a note on and its trills): a note on creates its node and connects it (its envelopes are in its
// processor, read at the note on: nothing is scheduled for them); the counts don't grow with the notes held,
// and every node is off the graph once its voice has ended

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
  it('a note: its node, connected, nothing scheduled (its envelopes are in its processor)', async () => {
    const { onPress, measure } = await setup();
    expect(measure(() => onPress(note(0)))).toEqual({ nodes: 1, connects: 1, disconnects: 0, automation: 0 });
  });

  it('a note while another is held glides its pitch from it with portamento (at 0 nothing)', async () => {
    const { onPress, synthActions, measure } = await setup();
    onPress(note(0));
    expect(measure(() => onPress(note(1)))).toEqual({ nodes: 1, connects: 1, disconnects: 0, automation: 0 });
    synthActions.setPortamento(100);
    // the frequency: from the note held, the 8 ramps of the curve to its own
    expect(measure(() => onPress(note(2)))).toEqual({ nodes: 1, connects: 1, disconnects: 0, automation: 9 });
  });

  it('mono: a note over the held one is only the glide of its voice, no node', async () => {
    const { onPress, onRelease, synthActions, measure } = await setup();
    synthActions.setMaxVoices(1);
    synthActions.setLegato(true);
    synthActions.setPortamento(100);
    onPress(note(0));
    // held where it is (a point, a cancel after it), the 8 ramps of the curve
    expect(measure(() => onPress(note(1)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 10,
    });
    // back to the key below
    expect(measure(() => onRelease(note(1)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 10,
    });
  });

  it('a note connects the mod bus of each param a source plays into', async () => {
    const { onPress, measure, osc1, audioCtx } = await setup();
    osc1[1].connectBus('position', audioCtx.createGain());
    osc1[1].connectBus('gain', audioCtx.createGain());
    expect(measure(() => onPress(note(0)))).toEqual({ nodes: 1, connects: 3, disconnects: 0, automation: 0 });
  });

  it('a note over the polyphony fades the oldest voice out', async () => {
    const { onPress, synthActions, measure } = await setup();
    synthActions.setMaxVoices(2);
    onPress(note(0));
    onPress(note(1));
    // the stolen voice: its gate below 0 (a cancel, a set: its processor fades it out); the new one doesn't
    // glide (portamento 0)
    expect(measure(() => onPress(note(2)))).toEqual({ nodes: 1, connects: 1, disconnects: 0, automation: 2 });
  });

  it('a note off sets the gate: its processor releases its envelopes', async () => {
    const { onPress, onRelease, measure } = await setup();
    onPress(note(0));
    expect(measure(() => onRelease(note(0)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 2,
    });
  });

  it('legato: the notes of a phrase are only their nodes (they share its envelopes), each releases at its key', async () => {
    const { onPress, onRelease, synthActions, measure } = await setup();
    synthActions.setLegato(true);
    expect(measure(() => onPress(note(0)))).toEqual({ nodes: 1, connects: 1, disconnects: 0, automation: 0 });
    expect(measure(() => onPress(note(1)))).toEqual({ nodes: 1, connects: 1, disconnects: 0, automation: 0 });
    expect(measure(() => onRelease(note(1)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 2,
    });
    expect(measure(() => onRelease(note(0)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 2,
    });
  });

  it('a chord of 12 at Poly 8 (in one task): 4 voices stolen as they start; its release', async () => {
    const { onPress, onRelease, measure } = await setup();
    const chord = Array.from({ length: 12 }, (_, i) => note(i));
    // nothing for the first 8 (no portamento), then 4 steals of 2
    expect(measure(() => chord.forEach((n) => onPress(n)))).toEqual({
      nodes: 12,
      connects: 12,
      disconnects: 0,
      automation: 8,
    });
    // the gates of the 8 voices held
    expect(measure(() => chord.forEach((n) => onRelease(n)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 16,
    });
  });

  it('the work of a note does not grow with the notes held', async () => {
    const { onPress, synthActions, measure } = await setup();
    synthActions.setMaxVoices(16);
    onPress(note(0));
    const each = Array.from({ length: 15 }, (_, i) => measure(() => onPress(note(i + 1))));
    each.forEach((cost) => expect(cost).toEqual({ nodes: 1, connects: 1, disconnects: 0, automation: 0 }));
  });

  it('an ended voice takes its node and its buses off the graph', async () => {
    const { onPress, onRelease, voices, end, measure, osc1, audioCtx } = await setup();
    osc1[1].connectBus('position', audioCtx.createGain());
    onPress(note(0));
    onRelease(note(0));
    const [voice] = voices();
    expect(measure(() => end(voice))).toEqual({ nodes: 0, connects: 0, disconnects: 2, automation: 0 });
    expect(isOff(voice)).toBe(true);
  });

  it('after many notes, steals and legato phrases, every ended voice is off the graph', async () => {
    const { onPress, onRelease, synthActions, voices, end, osc1, audioCtx } = await setup();
    osc1[1].connectBus('detune', audioCtx.createGain());
    // the volume of a voice is in its processor: no gain per voice
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
    expect(createGain).not.toHaveBeenCalled();
    // the bus: disconnected from every param it was connected to
    const bus = osc1[0].buses.detune as unknown as Record<'connect' | 'disconnect', jest.Mock>;
    expect(bus.connect.mock.calls.length).toBeGreaterThan(0);
    expect(bus.disconnect.mock.calls.length).toBe(bus.connect.mock.calls.length);
    // no voice is left following the knobs
    expect(work(audioCtx, () => osc1[1].setGain(0.3)).automation).toBe(0);
  });
});
