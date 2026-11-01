import { readFileSync } from 'fs';
import { join } from 'path';
import { blendGains } from '../../../common/wavetable/unison-levels';
import { UNISON_SHAPE, UnisonStack } from '../../../common/wavetable/voice-options';
import { unisonVoices } from './unison-voices';

const measured = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../../../../../../../dsp/measurements', name), 'utf8'));
// the reference AU: each voice of `u<n> <blend>` [cents, left, right] in dB against one voice (null: not heard)
const MEASURED: { levels: Record<string, [number, number | null, number | null][]> } = measured('blend.json');
// the voices of each stack `<name> u<n>` at Detune 0.5 (±35 cents) from the lowest detune: their semitones
const MEASURED_STACKS: Record<string, { step: number }[]> = measured('unison.json').stacks;
const STACKS: Record<string, UnisonStack> = {
  off: 'off',
  '12 (1x)': '12x1',
  '12 (2x)': '12x2',
  '12 (3x)': '12x3',
  '12+7 (1x)': '12+7x1',
  '12+7 (2x)': '12+7x2',
  '12+7 (3x)': '12+7x3',
  'Center-12': 'center-12',
  'Center-24': 'center-24',
};

describe('unisonVoices', () => {
  it('spreads the voices from the lowest by the detune mode, the shares of a random one evenly', () => {
    const cents = (detune: typeof UNISON_SHAPE.detune) =>
      unisonVoices(5, 40, 0.5, { ...UNISON_SHAPE, detune }).map((voice) => voice.cents);
    expect(cents('linear')).toEqual([-20, -10, 0, 10, 20]);
    expect(cents('random')).toEqual(cents('linear'));
    // the inner voices closer (super, exp), out to the edges (inv); the ends at ±20 each
    const [, superInner] = cents('super');
    const [, expInner] = cents('exp');
    const [, invInner] = cents('inv');
    expect(superInner).toBeGreaterThan(-10);
    expect(expInner).toBe(-5);
    expect(invInner).toBeCloseTo(-20 * Math.sin(Math.PI / 4), 10);
    expect(cents('super')[0]).toBeCloseTo(-20, 10);
  });

  it('plays one voice at no spread, unless a route raises it, a stack or a position spread keeps them', () => {
    expect(unisonVoices(8, 0, 0.5, UNISON_SHAPE)).toEqual([
      { cents: 0, stack: 0, amplitude: 1, isCenter: true },
    ]);
    // (a route that raises the spread: the voice keeps them all, at the middle until it moves them)
    const raised = unisonVoices(8, 0, 0.5, UNISON_SHAPE, true);
    expect(raised.map(({ cents }) => cents)).toEqual(Array(8).fill(0));
    expect(raised.map(({ amplitude }) => amplitude)).toEqual(
      unisonVoices(8, 20, 0.5, UNISON_SHAPE).map(({ amplitude }) => amplitude)
    );
    expect(unisonVoices(8, 0, 0.5, { ...UNISON_SHAPE, stack: '12x1' })).toHaveLength(8);
    expect(unisonVoices(8, 0, 0.5, { ...UNISON_SHAPE, positionSpread: 0.5 })).toHaveLength(8);
  });

  it.each(Object.entries(MEASURED_STACKS).filter(([key]) => Number(key.split(' u')[1]) <= 8))(
    'moves the voices of a stack as the reference AU: %s',
    (key, voices) => {
      const [name, n] = key.split(' u');
      const shown = unisonVoices(Number(n), 70, 0.5, { ...UNISON_SHAPE, stack: STACKS[name] })
        .map(({ cents, stack }) => ({ step: stack / 100, detune: cents - stack }))
        .sort((a, b) => a.detune - b.detune);
      expect(shown.map(({ step }) => step)).toEqual(voices.map(({ step }) => step));
    }
  );

  it('gives each voice its level in its channel as the reference AU, within 0.05 dB', () => {
    // its 2..8 voices at 21 blends (scripts/renders/run.mjs --only=blend); a voice is in one channel, the middle one
    // of an odd count in both
    Object.entries(MEASURED.levels).forEach(([key, measured]) => {
      const [unison, blend] = key.slice(1).split(' ').map(Number);
      const voices = unisonVoices(unison, 20, blend, UNISON_SHAPE);
      expect(voices).toHaveLength(measured.length);
      voices.forEach(({ amplitude }, v) => {
        const [, left, right] = measured[v];
        expect(
          Math.abs(20 * Math.log10(amplitude) - Math.max(left ?? -Infinity, right ?? -Infinity))
        ).toBeLessThan(0.05);
      });
    });
  });

  it('keeps a unison of 1 or 2 at its level whatever the blend', () => {
    expect(unisonVoices(1, 20, 0, UNISON_SHAPE)).toEqual(unisonVoices(1, 20, 1, UNISON_SHAPE));
    expect(unisonVoices(2, 20, 0, UNISON_SHAPE)).toEqual(unisonVoices(2, 20, 1, UNISON_SHAPE));
  });

  it('has the middle one of an odd count and the middle two of an even one as its centre', () => {
    expect(unisonVoices(5, 20, 0, UNISON_SHAPE).map(({ isCenter }) => isCenter)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(unisonVoices(4, 20, 0, UNISON_SHAPE).map(({ isCenter }) => isCenter)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe('blendGains', () => {
  it('never silences the centre nor the others, within 0..1', () => {
    // the others 27 dB under the centre at 0, 8.6 dB at 0.5, the centre 2.5 dB under them at 1 (the middle one of an
    // odd count 8 dB under those: its pan)
    const ratio = (blend: number) => {
      const [center, side] = blendGains(blend);
      return 20 * Math.log10(side / center);
    };
    expect(ratio(0)).toBeCloseTo(-27.0, 1);
    expect(ratio(0.5)).toBeCloseTo(-8.6, 1);
    expect(ratio(1)).toBeCloseTo(2.5, 1);
    expect(blendGains(-1)).toEqual(blendGains(0));
    expect(blendGains(2)).toEqual(blendGains(1));
  });
});
