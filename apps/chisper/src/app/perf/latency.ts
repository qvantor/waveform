import type { VoiceStart } from '../synth/common/modules/synth';
import type { ProbeOnsetMessage } from './probe-dsp';

// the timing of the notes in the perf build (perf-api.ts traces them): the input event, the note on it caused,
// the start of its voice and the onsets the probe heard; times in ms of performance.now(), frames of the context

export interface InputEventTime {
  type: string;
  timeStamp: number;
  // the event had no usable time stamp: the time the capture listener got it
  estimated?: boolean;
}

export interface ReleaseRecord {
  note: string;
  event: InputEventTime | null;
  // the capture listener got the event (the handlers of the app run right after)
  handled: number | null;
  // after the synth's note on / off, and the context time then
  at: number;
  contextTime: number;
}

export interface PressRecord extends ReleaseRecord {
  // the oscillator wasn't ready: the note is dropped (Voicing.onPress)
  lost: boolean;
  state: AudioContextState;
  // getOutputTimestamp() at the note on (none, or zero before the context runs: null)
  output: { contextTime: number; performanceTime: number } | null;
}

export interface NoteRecord extends PressRecord {
  // the frames its voice was scheduled and started at
  scheduled: number | null;
  started: number | null;
  // the onsets the probe heard: the voices (before the filter and the effects), the output (after the limiter)
  onsets: [number | null, number | null];
}

export interface NoteLatency {
  // event → its handler (the main thread was busy)
  toHandler: number | null;
  // the handler: the note on of the synth
  noteOn: number;
  // the scheduled frame → the one the voice started at (its node was created late)
  renderLag: number | null;
  // event → the start of its voice, its scheduled frame taken as the note on: the main thread and the render
  // lag, what the page adds; not the wait for the next device callback (up to a device buffer) nor the output
  // (outputPath)
  toVoice: number | null;
  // the voices → the output: filter, effects, limiter
  dsp: number | null;
  // the note on → its scheduled frame at the output of the device (getOutputTimestamp, null without one; WebKit's
  // is its render clock, the report leaves it out): the wait for the device callback, the buffers, the latency
  // of the output; the browser and the device, not the page
  outputPath: number | null;
  // event → the output of the device: toVoice, its onset (the output onset when the probe heard it, else the
  // start of the voice) and the output path
  toOutput: number | null;
}

// the frames between a press (its context time) and the frame its voice was scheduled at, at most: both are
// read in the task of the note on (a context time may move by a render quantum or two meanwhile); presses of a
// note are 100 ms (4800 frames) apart at least
const MATCH_FRAMES = 1024;

// the voice of a press: the start of its note scheduled at the frame of the press (a lost press never starts, a
// voice that never posts its start leaves the next ones to their own presses); the onsets of a voice: the first
// ones within `window` seconds after its start, each claimed once
export const matchNotes = (
  presses: PressRecord[],
  starts: VoiceStart[],
  onsets: ProbeOnsetMessage[],
  sampleRate: number,
  window = 0.1
): NoteRecord[] => {
  const records: NoteRecord[] = presses.map((press) => ({
    ...press,
    scheduled: null,
    started: null,
    onsets: [null, null],
  }));
  starts.forEach(({ note, scheduled, started }) => {
    const distance = (press: NoteRecord) => Math.abs(Math.ceil(press.contextTime * sampleRate) - scheduled);
    const record = records
      .filter((press) => !press.lost && press.note === note && press.started === null)
      .filter((press) => distance(press) <= MATCH_FRAMES)
      .sort((a, b) => distance(a) - distance(b))[0];
    if (!record) return;
    record.scheduled = scheduled;
    record.started = started;
  });
  const span = window * sampleRate;
  const claimed = new Set<ProbeOnsetMessage>();
  const claim = (input: number, from: number) => {
    const onset = onsets.find(
      (candidate) =>
        candidate.input === input &&
        !claimed.has(candidate) &&
        candidate.onset >= from &&
        candidate.onset < from + span
    );
    if (!onset) return null;
    claimed.add(onset);
    return onset.onset;
  };
  records.forEach((record) => {
    if (record.started === null) return;
    const voices = claim(0, record.started);
    record.onsets = [voices, voices === null ? null : claim(1, voices)];
  });
  return records;
};

// the parts of the latency of a note, ms. Its voice is scheduled at the context time when the synth plays it:
// the scheduled frame is the clock of the context at the note on (`at`); the context time the hook reads after
// it may be a render quantum later (a device callback in between), which would take a block off toVoice
export const noteLatency = (
  { event, handled, at, scheduled, started, onsets, output }: NoteRecord,
  sampleRate: number
): NoteLatency => {
  const ms = (frames: number) => (frames / sampleRate) * 1000;
  const toHandler = event && handled !== null ? handled - event.timeStamp : null;
  const noteOn = at - (handled ?? event?.timeStamp ?? at);
  const timed = started !== null && scheduled !== null;
  const renderLag = timed ? ms(started - scheduled) : null;
  const toVoice = event && timed ? at - event.timeStamp + ms(started - scheduled) : null;
  const [voices, out] = onsets;
  const dsp = voices !== null && out !== null ? ms(out - voices) : null;
  const outputPath =
    timed && output ? output.performanceTime - output.contextTime * 1000 + ms(scheduled) - at : null;
  // to the output onset when the probe heard it, else to the start of the voice
  const toOutput =
    toVoice !== null && outputPath !== null && started !== null
      ? toVoice + ms((out ?? started) - started) + outputPath
      : null;
  return { toHandler, noteOn, renderLag, toVoice, dsp, outputPath, toOutput };
};
