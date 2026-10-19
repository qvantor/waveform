import { matchNotes, NoteRecord, noteLatency, PressRecord } from './latency';

const RATE = 48000;

const press = (note: string, values: Partial<PressRecord> = {}): PressRecord => ({
  note,
  lost: false,
  state: 'running',
  event: { type: 'keydown', timeStamp: 1000 },
  handled: 1002,
  at: 1003,
  contextTime: 1,
  output: null,
  ...values,
});

describe('note latency', () => {
  describe('matchNotes', () => {
    // a press at the context time of a frame
    const at = (note: string, frame: number, values: Partial<PressRecord> = {}) =>
      press(note, { contextTime: frame / RATE, ...values });

    it('gives each voice start to the press it was scheduled at, a lost press gets none', () => {
      const presses = [at('A4', 0, { lost: true }), at('A4', 48000), at('C4', 72000), at('A4', 96000)];
      const starts = [
        { note: 'A4', scheduled: 48000, started: 48128 },
        { note: 'C4', scheduled: 72000, started: 72128 },
        { note: 'A4', scheduled: 96000, started: 96256 },
      ];
      const records = matchNotes(presses, starts, [], RATE);
      expect(records.map(({ started }) => started)).toEqual([null, 48128, 72128, 96256]);
      expect(records[1].scheduled).toBe(48000);
    });

    it('leaves the next starts to their own presses when a voice never starts', () => {
      const presses = [at('A4', 48000), at('A4', 96000), at('A4', 144000)];
      const starts = [
        { note: 'A4', scheduled: 96000, started: 96128 },
        { note: 'A4', scheduled: 144000, started: 144128 },
      ];
      expect(matchNotes(presses, starts, [], RATE).map(({ started }) => started)).toEqual([
        null,
        96128,
        144128,
      ]);
    });

    it('takes the context time a render quantum or two off the scheduled frame, not farther', () => {
      const presses = [at('A4', 47872), at('C4', 70000)];
      const starts = [
        { note: 'A4', scheduled: 48000, started: 48000 },
        { note: 'C4', scheduled: 72000, started: 72000 },
      ];
      expect(matchNotes(presses, starts, [], RATE).map(({ started }) => started)).toEqual([48000, null]);
    });

    it('claims the first onsets of the voices then of the output after the start, within the window', () => {
      const presses = [at('A4', 1000), at('C4', 30000), at('E4', 60000)];
      const starts = [
        { note: 'A4', scheduled: 1000, started: 1000 },
        { note: 'C4', scheduled: 30000, started: 30000 },
        { note: 'E4', scheduled: 60000, started: 60000 },
      ];
      const onsets = [
        // before the first voice: no one's
        { onset: 900, input: 1 },
        { onset: 1000, input: 0 },
        { onset: 1120, input: 1 },
        { onset: 30010, input: 0 },
        { onset: 30130, input: 1 },
        // later than 0.1 s after E4
        { onset: 65000, input: 0 },
      ];
      const records = matchNotes(presses, starts, onsets, RATE);
      expect(records.map((record) => record.onsets)).toEqual([
        [1000, 1120],
        [30010, 30130],
        [null, null],
      ]);
    });

    it('claims an onset once', () => {
      const presses = [at('A4', 0), at('C4', 10)];
      const starts = [
        { note: 'A4', scheduled: 0, started: 0 },
        { note: 'C4', scheduled: 10, started: 10 },
      ];
      const records = matchNotes(presses, starts, [{ onset: 20, input: 0 }], RATE);
      expect(records.map((record) => record.onsets[0])).toEqual([20, null]);
    });
  });

  describe('noteLatency', () => {
    const record = (values: Partial<NoteRecord> = {}): NoteRecord => ({
      ...press('A4'),
      scheduled: 48000,
      started: 48128,
      onsets: [48128, 48240],
      ...values,
    });
    const output = { contextTime: 0.99, performanceTime: 1010 };

    it('splits the latency of a note into its parts, ms', () => {
      const latency = noteLatency(record(), RATE);
      expect(latency.toHandler).toBe(2);
      expect(latency.noteOn).toBe(1);
      expect(latency.renderLag).toBeCloseTo((128 / RATE) * 1000);
      // the note on at 1003, its voice a block after its scheduled frame (the clock of the context then)
      expect(latency.toVoice).toBeCloseTo(5.6667, 3);
      expect(latency.dsp).toBeCloseTo((112 / RATE) * 1000);
    });

    it('has no output path without getOutputTimestamp (the base and output latency leave the callback out)', () => {
      expect(noteLatency(record(), RATE)).toMatchObject({ outputPath: null, toOutput: null });
    });

    it('takes the clock of the context at the note on from the scheduled frame, not the read after it', () => {
      const exact = noteLatency(record({ output }), RATE);
      // a device callback between the note on and the hook: the context time a block on
      const late = noteLatency(record({ output, contextTime: 1 + 512 / RATE }), RATE);
      expect(late.toVoice).toBeCloseTo(exact.toVoice as number);
      expect(late.outputPath).toBeCloseTo(exact.outputPath as number);
    });

    it('takes the output time of getOutputTimestamp', () => {
      const latency = noteLatency(record({ output }), RATE);
      // the frame of the context time at the note on (1000 ms) leaves the device at 1010 + 1000 - 990, 17 ms
      // after the note on (1003)
      expect(latency.outputPath).toBeCloseTo(17);
      // the output onset (1005 ms of context time) leaves the device at 1010 + 1005 - 990
      expect(latency.toOutput).toBeCloseTo(25);
      expect(latency.toOutput).toBeCloseTo(
        (latency.toVoice as number) + (112 / RATE) * 1000 + (latency.outputPath as number)
      );
    });

    it('counts a slower note on in toVoice, not in the output path: the same frame leaves at the same time', () => {
      const quick = noteLatency(record({ output }), RATE);
      const slow = noteLatency(record({ output, at: 1008 }), RATE);
      expect((slow.toVoice as number) - (quick.toVoice as number)).toBeCloseTo(5);
      expect((slow.outputPath as number) - (quick.outputPath as number)).toBeCloseTo(-5);
      expect(slow.toOutput).toBeCloseTo(quick.toOutput as number);
    });

    it('from the start of the voice when the probe heard no output', () => {
      const latency = noteLatency(record({ output, onsets: [null, null] }), RATE);
      expect(latency.dsp).toBeNull();
      expect(latency.toOutput).toBeCloseTo(5.6667 + 17, 3);
    });

    it('leaves out what it has no times for', () => {
      expect(noteLatency(record({ output, event: null, handled: null }), RATE)).toMatchObject({
        toHandler: null,
        noteOn: 0,
        toVoice: null,
        toOutput: null,
      });
      expect(noteLatency(record({ output, scheduled: null, started: null }), RATE)).toMatchObject({
        renderLag: null,
        toVoice: null,
        outputPath: null,
        toOutput: null,
      });
    });
  });
});
