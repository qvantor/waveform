import { EnvelopeParams } from '../../common/envelope/envelope-curve';
import { createFxModulator, FxNote, FxRoute, routedValue } from './fx-modulation';

const RATE = 48000;
const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
// ENV 2: up in 100 ms, down to half in the next 100 ms, released in 200 ms
const ENV: EnvelopeParams = { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.5, release: 0.2 };
const note = (release: number | null = null): FxNote => ({ envelopes: [FLAT, ENV, FLAT], start: 1, release });
const drive: FxRoute = { param: 'drive', env: 1, amount: 6, min: 0, max: 12 };

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

  it('sums the routes, clamps to the range, a log knob moves by octaves', () => {
    const both = [drive, { ...drive, env: 0, amount: 5 }];
    expect(routedValue(2, both, note(), 1.1)).toBe(12);
    expect(routedValue(2, [{ ...drive, amount: -6 }], note(), 1.1)).toBe(0);
    const tone: FxRoute = { param: 'tone', env: 1, amount: -2, min: 500, max: 20000, log: true };
    expect(routedValue(8000, [tone], note(), 1.1)).toBeCloseTo(2000);
    expect(routedValue(8000, [tone], note(), 3)).toBeCloseTo(4000);
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
    const tone: FxRoute = { param: 'tone', env: 1, amount: -1, min: 500, max: 20000, log: true };
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
