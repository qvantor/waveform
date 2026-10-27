import { EnvelopeParams } from '../../common/envelope/envelope-curve';
import { FREE, frac, lfoTable, LfoWire, RETRIG } from '../../common/lfo/lfo-curve';
import { createFxModulator, createNoteLfos, FxNote, FxRoute, routedValue } from './fx-modulation';

const RATE = 48000;
const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
// ENV 2: up in 100 ms, down to half in the next 100 ms, released in 200 ms
const ENV: EnvelopeParams = { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.5, release: 0.2 };
const note = (release: number | null = null): FxNote => ({ envelopes: [FLAT, ENV, FLAT], start: 1, release });
const drive: FxRoute = { param: 'drive', source: 1, amount: 6, min: 0, max: 12 };

describe('routedValue', () => {
  it('moves the knob by amount × the level of the envelope of the note', () => {
    expect(routedValue(2, [drive], note(), 0.5)).toBe(2);
    expect(routedValue(2, [drive], note(), 1.05)).toBeCloseTo(5);
    expect(routedValue(2, [drive], note(), 1.1)).toBeCloseTo(8);
    expect(routedValue(2, [drive], note(), 3)).toBeCloseTo(5);
    // released at 3 s from its sustain
    expect(routedValue(2, [drive], note(3), 3.1)).toBeCloseTo(3.5);
    expect(routedValue(2, [drive], note(3), 4)).toBe(2);
  });

  it('follows a note that started the envelopes again from their levels: no step at its start', () => {
    // ENV 2 started again at 1 from 0.5: up to 1 in its 100 ms
    const again: FxNote = { ...note(), from: [1, 0.5, 1] };
    expect(routedValue(2, [drive], again, 1)).toBeCloseTo(5);
    expect(routedValue(2, [drive], again, 1.05)).toBeCloseTo(6.5);
    expect(routedValue(2, [drive], again, 1.1)).toBeCloseTo(8);
  });

  it('sums the routes, clamps to the range, a log knob moves by octaves', () => {
    const both = [drive, { ...drive, source: 0, amount: 5 }];
    expect(routedValue(2, both, note(), 1.1)).toBe(12);
    expect(routedValue(2, [{ ...drive, amount: -6 }], note(), 1.1)).toBe(0);
    const tone: FxRoute = { param: 'tone', source: 1, amount: -2, min: 500, max: 20000, scale: 'log' };
    expect(routedValue(8000, [tone], note(), 1.1)).toBeCloseTo(2000);
    expect(routedValue(8000, [tone], note(), 3)).toBeCloseTo(4000);
  });
});

describe('routedValue of the velocity', () => {
  // VELO: the source after the envelopes
  const velo: FxRoute = { ...drive, source: 3 };

  it('moves the knob by amount × VELO of the note, the same all along it, released too', () => {
    const played: FxNote = { ...note(2), velo: 0.5, velocity: 0.5 };
    [0.5, 1, 1.05, 3, 10].forEach((t) => expect(routedValue(2, [velo], played, t)).toBe(5));
    expect(routedValue(2, [velo, drive], played, 1.1)).toBeCloseTo(11);
  });

  it('a note without one: no VELO', () => {
    expect(routedValue(2, [velo], note(), 1)).toBe(2);
  });
});

describe('createFxModulator', () => {
  const frame = (seconds: number) => Math.round(seconds * RATE);

  it('computes nothing without routes, lets every knob through', () => {
    const modulator = createFxModulator(RATE, { drive: 2, tone: 8000 });
    expect(modulator.block(0)).toBeNull();
    expect(modulator.bases({ drive: 3 })).toEqual({ drive: 3 });
  });

  it('sets a moved knob once per block where its value changed, holds back its posted value', () => {
    const modulator = createFxModulator(RATE, { drive: 2, tone: 8000 });
    modulator.set({ note: note(), routes: [drive] });
    expect(modulator.block(frame(1.05))).toEqual({ drive: expect.closeTo(5, 3) });
    expect(modulator.block(frame(1.05))).toBeNull();
    // the sustain: once
    expect(modulator.block(frame(2))).toEqual({ drive: 5 });
    expect(modulator.block(frame(2.5))).toBeNull();
    // a knob turned: its routes move it from there
    expect(modulator.bases({ drive: 4, tone: 5000 })).toEqual({ tone: 5000 });
    expect(modulator.block(frame(2.5))).toEqual({ drive: 7 });
  });

  it('a knob that loses its route goes back to its value', () => {
    const modulator = createFxModulator(RATE, { drive: 2 });
    modulator.set({ note: note(), routes: [drive] });
    modulator.block(frame(2));
    modulator.set(null);
    expect(modulator.block(frame(2.1))).toEqual({ drive: 2 });
    expect(modulator.block(frame(2.2))).toBeNull();
  });

  it('a knob that loses its route goes back to its value, also when routes change again before the block', () => {
    const modulator = createFxModulator(RATE, { drive: 2, tone: 8000 });
    const tone: FxRoute = { param: 'tone', source: 1, amount: -1, min: 500, max: 20000, scale: 'log' };
    modulator.set({ note: note(), routes: [drive, tone] });
    modulator.block(frame(2));
    modulator.set({ note: note(), routes: [tone] });
    // a new note within the same block
    modulator.set({ note: { ...note(), start: 2 }, routes: [tone] });
    expect(modulator.block(frame(2))).toEqual({ drive: 2, tone: 8000 });
    expect(modulator.block(frame(2.1))).toEqual({ tone: expect.closeTo(4000, 6) });
  });

  it('a new note starts the envelope again', () => {
    const modulator = createFxModulator(RATE, { drive: 2 });
    modulator.set({ note: note(), routes: [drive] });
    expect(modulator.block(frame(2))).toEqual({ drive: 5 });
    modulator.set({ note: { ...note(), start: 2 }, routes: [drive] });
    expect(modulator.block(frame(2))).toEqual({ drive: 2 });
  });
});

describe('routedValue of a bipolar route and a pow knob', () => {
  it('moves a knob around its value: amount × (level - ½)', () => {
    const bipolar: FxRoute = { ...drive, bipolar: true };
    // ENV 2 at 1 at 1.1 s, at its sustain (½) at 3 s
    expect(routedValue(6, [bipolar], note(), 1.1)).toBeCloseTo(9);
    expect(routedValue(6, [bipolar], note(), 3)).toBeCloseTo(6);
    expect(routedValue(6, [bipolar], note(), 0.5)).toBe(3);
  });

  it('moves a time by a share of its travel', () => {
    const delay: FxRoute = { param: 'lfo1.delay', source: 1, amount: 0.25, min: 0, max: 32, scale: 'pow' };
    // the share of 2 s of 32: ½, + ¼ × 1
    expect(routedValue(2, [delay], note(), 1.1)).toBeCloseTo(32 * 0.75 ** 4);
  });
});

describe('createNoteLfos', () => {
  const RATE_48 = 48000;
  const lfo = (change: Partial<LfoWire> = {}): LfoWire => ({
    mode: RETRIG,
    delay: 0,
    rise: 0,
    smooth: 0,
    phase: 0,
    anchor: { time: 0, phase: 0, period: 1 },
    table: lfoTable('saw-up'),
    ...change,
  });
  const setup = (first: Partial<LfoWire> = {}) => {
    const lfos = createNoteLfos(RATE_48);
    lfos.setLfos({ at: 0, instantly: true, lfos: [lfo(first), lfo(), lfo(), lfo()] });
    return lfos;
  };
  const at = (seconds: number) => seconds * RATE_48;

  it('runs on the clock without a note, its Delay and Rise passed', () => {
    const lfos = setup({ delay: 1, rise: 1, anchor: { time: 0, phase: 0.1, period: 1 } });
    expect(lfos.level(0, at(0.3))).toBeCloseTo(0.4, 5);
    expect(lfos.position(0)).toBeCloseTo(0.4, 5);
  });

  it('retrig from the start of the note, on after its release; free on the clock', () => {
    const lfos = setup({ delay: 0.1 });
    lfos.follow(note());
    expect(lfos.level(0, at(1.05))).toBe(0);
    expect(lfos.level(0, at(1.35))).toBeCloseTo(0.25, 5);
    // released: it goes on
    lfos.follow(note(1.4));
    expect(lfos.level(0, at(1.6))).toBeCloseTo(0.5, 5);
    const free = setup({ mode: FREE, anchor: { time: 0, phase: 0.5, period: 1 } });
    free.follow(note());
    expect(free.level(0, at(2.2))).toBeCloseTo(frac(0.5 + 2.2), 5);
  });

  it('a note started again on its voice (mono) starts it again, smoothed on', () => {
    const lfos = setup();
    lfos.follow(note());
    lfos.level(0, at(1.5));
    lfos.follow({ ...note(), start: 2, from: [1, 0.5, 1] });
    expect(lfos.level(0, at(2.25))).toBeCloseTo(0.25, 5);
  });

  it('the routes of the note move its knobs: ENV 2 on Rate (an octave: twice as fast)', () => {
    const lfos = setup();
    const flat = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
    lfos.follow({ envelopes: [flat, flat, flat], start: 1, release: null });
    lfos.setRoutes([{ param: 'lfo1.rate', source: 1, amount: 1, min: 1 / 32, max: 100, scale: 'log' }]);
    expect(lfos.level(0, at(1.2))).toBeCloseTo(0.4, 4);
    // an LFO on a knob of an LFO is left out
    lfos.setRoutes([{ param: 'lfo1.rate', source: 5, amount: 1, min: 1 / 32, max: 100, scale: 'log' }]);
    const plain = setup();
    plain.follow({ envelopes: [flat, flat, flat], start: 1, release: null });
    expect(lfos.level(0, at(1.4))).toBeCloseTo(plain.level(0, at(1.4)) + 0.2, 4);
  });
});
