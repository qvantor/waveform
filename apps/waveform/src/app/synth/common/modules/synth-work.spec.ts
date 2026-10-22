import { Note } from '@waveform/ui-kit';
import { createSynth } from '../../../../test-utils/models';
import { work } from '../../../../test-utils/audio-work';
import { voiceEvents, voicesNodes, voiceWork } from '../../../../test-utils/voice-events';
import { seeded } from '../../../../test-utils/voice-dsp';

// the work of the main thread per note, as exact counts (it replaces the browser suite's budget of a note on and
// its trills): a note on is an event to the voices node (its envelopes are in the node, read at the note on:
// nothing is scheduled for them), the events of a task one message; nothing in the audio graph; the counts don't
// grow with the notes held, and no voice that has ended is sent anything

// the wavetable oscillator loads its module asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));

const NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// the n-th note of a run up from C3
const note = (n: number): Note => [3 + Math.floor(n / NOTES.length), NOTES[n % NOTES.length]] as Note;

const setup = async () => {
  const modules = createSynth();
  const [{ audioCtx, wavetables }] = modules.synthCore;
  const [, { onPress, onRelease }] = modules.inputController;
  const [synthModel, synthActions] = modules.synth;
  await flush();
  const { voices, end } = voiceEvents(audioCtx, wavetables);
  // the events of an operation; it changes nothing in the audio graph
  const measure = (operation: () => void) => {
    let events = voiceWork(audioCtx, wavetables, () => undefined);
    expect(work(audioCtx, () => (events = voiceWork(audioCtx, wavetables, operation)))).toEqual({
      nodes: 0,
      connects: 0,
      disconnects: 0,
      automation: 0,
    });
    return events;
  };
  return { ...modules, audioCtx, onPress, onRelease, synthModel, synthActions, voices, end, measure };
};

describe('the work of a note on the main thread', () => {
  it('a note: its voice, nothing scheduled (its envelopes are in the voices node)', async () => {
    const { onPress, measure } = await setup();
    expect(measure(() => onPress(note(0)))).toEqual({ messages: 1, voices: 1, automation: 0, changes: 0 });
  });

  it('a note while another is held glides its pitch from it with portamento (at 0 nothing)', async () => {
    const { onPress, synthActions, measure } = await setup();
    onPress(note(0));
    expect(measure(() => onPress(note(1)))).toEqual({ messages: 1, voices: 1, automation: 0, changes: 0 });
    synthActions.setPortamento(100);
    // the frequency: from the note held, the 8 ramps of the curve to its own
    expect(measure(() => onPress(note(2)))).toEqual({ messages: 1, voices: 1, automation: 9, changes: 0 });
  });

  it('mono: a note over the held one is only the glide of its voice, no voice', async () => {
    const { onPress, onRelease, synthActions, measure } = await setup();
    synthActions.setMaxVoices(1);
    synthActions.setLegato(true);
    synthActions.setPortamento(100);
    onPress(note(0));
    // held where it is (a point, a cancel after it), the 8 ramps of the curve
    expect(measure(() => onPress(note(1)))).toEqual({ messages: 1, voices: 0, automation: 10, changes: 0 });
    // back to the key below
    expect(measure(() => onRelease(note(1)))).toEqual({ messages: 1, voices: 0, automation: 10, changes: 0 });
  });

  it('a note over the polyphony fades the oldest voice out', async () => {
    const { onPress, synthActions, measure } = await setup();
    synthActions.setMaxVoices(2);
    onPress(note(0));
    onPress(note(1));
    // the stolen voice: its gate below 0 (a cancel, a set: the voices node fades it out); the new one doesn't
    // glide (portamento 0)
    expect(measure(() => onPress(note(2)))).toEqual({ messages: 1, voices: 1, automation: 2, changes: 0 });
  });

  it('a note off sets the gate: the voices node releases its envelopes', async () => {
    const { onPress, onRelease, measure } = await setup();
    onPress(note(0));
    expect(measure(() => onRelease(note(0)))).toEqual({ messages: 1, voices: 0, automation: 2, changes: 0 });
  });

  it('legato: the notes of a phrase are only their voices (they share its envelopes), each releases at its key', async () => {
    const { onPress, onRelease, synthActions, measure } = await setup();
    synthActions.setLegato(true);
    expect(measure(() => onPress(note(0)))).toEqual({ messages: 1, voices: 1, automation: 0, changes: 0 });
    expect(measure(() => onPress(note(1)))).toEqual({ messages: 1, voices: 1, automation: 0, changes: 0 });
    expect(measure(() => onRelease(note(1)))).toEqual({ messages: 1, voices: 0, automation: 2, changes: 0 });
    expect(measure(() => onRelease(note(0)))).toEqual({ messages: 1, voices: 0, automation: 2, changes: 0 });
  });

  it('a chord of 12 at Poly 8 (in one task): one message, 4 voices stolen as they start; its release', async () => {
    const { onPress, onRelease, measure } = await setup();
    const chord = Array.from({ length: 12 }, (_, i) => note(i));
    // nothing for the first 8 (no portamento), then 4 steals of 2
    expect(measure(() => chord.forEach((n) => onPress(n)))).toEqual({
      messages: 1,
      voices: 12,
      automation: 8,
      changes: 0,
    });
    // the gates of the 8 voices held
    expect(measure(() => chord.forEach((n) => onRelease(n)))).toEqual({
      messages: 1,
      voices: 0,
      automation: 16,
      changes: 0,
    });
  });

  it('the work of a note does not grow with the notes held', async () => {
    const { onPress, synthActions, measure } = await setup();
    synthActions.setMaxVoices(16);
    onPress(note(0));
    const each = Array.from({ length: 15 }, (_, i) => measure(() => onPress(note(i + 1))));
    each.forEach((cost) => expect(cost).toEqual({ messages: 1, voices: 1, automation: 0, changes: 0 }));
  });

  it('a voice that has ended is sent nothing more: the knobs and the routes reach the others', async () => {
    const { onPress, onRelease, voices, end, measure, osc1, modulation } = await setup();
    onPress(note(0));
    onPress(note(1));
    onRelease(note(0));
    const [voice] = voices();
    expect(measure(() => end(voice))).toEqual({ messages: 0, voices: 0, automation: 0, changes: 0 });
    // a glide of the knob (a cancel, a target, a set) and the routes of the other voice
    expect(measure(() => osc1[1].setGain(0.3))).toEqual({
      messages: 1,
      voices: 0,
      automation: 3,
      changes: 0,
    });
    expect(measure(() => modulation[1].addRoute('env2', 'osc1.gain'))).toEqual({
      messages: 1,
      voices: 0,
      automation: 0,
      changes: 1,
    });
  });

  it('after many notes, steals and legato phrases, no voice that has ended follows the knobs', async () => {
    const { onPress, onRelease, synthActions, synthModel, voices, end, audioCtx, osc1, measure } =
      await setup();
    // the volume of a voice is in the voices node: no gain per voice
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
    expect(synthModel.voicing.silent).toBe(true);
    expect(synthModel.$voicesCount.value).toBe(0);
    expect(voicesNodes(audioCtx)).toHaveLength(1);
    expect(createGain).not.toHaveBeenCalled();
    expect(measure(() => osc1[1].setGain(0.3))).toEqual({
      messages: 0,
      voices: 0,
      automation: 0,
      changes: 0,
    });
  });
});
