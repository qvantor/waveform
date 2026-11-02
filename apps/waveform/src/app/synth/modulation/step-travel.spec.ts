import { delayDivisions, divisionIndex, divisionSeconds, TIME_DIVISIONS } from '@waveform/preset-schema';
import { MOD_TARGETS } from '../common/modulation/modulation-targets';
import { rateStepsAt } from '../common/modules/lfos';
import { delayDivisionSeconds } from '../fx/effects/delay';
import { stepTravel } from './step-travel';

// the scale and the range of the routes of a target
const scaleOf = (target: string) => {
  const definition = MOD_TARGETS[target];
  if (definition?.kind !== 'lfo' && definition?.kind !== 'fx') throw new Error(target);
  return [definition.scale, definition.range] as const;
};

// Rate in BPM at 120: right faster, the frequency as the LFO plays it
const RATE_STEPS = [...rateStepsAt({ trip: false, dot: false }, 120)].reverse();
const rateOf = (division: number, bpm: number) => 1 / divisionSeconds(division, bpm);

// the travel of the routes of a knob of `steps` at `division`, its values by `valueOf` at `bpm`
const travelOf = (
  target: string,
  steps: number[],
  division: string,
  valueOf: (division: number, bpm: number) => number,
  bpm = 120
) =>
  stepTravel(
    steps.map((step) => valueOf(step, bpm)),
    steps.indexOf(divisionIndex(division)),
    ...scaleOf(target)
  );

// the share of the travel of a knob of `steps` at `division`
const shareOf = (steps: number[], division: string) =>
  steps.indexOf(divisionIndex(division)) / (steps.length - 1);

describe('stepTravel', () => {
  it('puts the knob at its step: the routes from there', () => {
    const { position, travel } = travelOf('lfo1.rate', RATE_STEPS, '1/4', rateOf);
    expect(travel(position)).toBeCloseTo(shareOf(RATE_STEPS, '1/4'), 12);
  });

  it('moves Rate by octaves of the frequency of HZ: an octave up is the next straight step', () => {
    const { position, travel } = travelOf('lfo1.rate', RATE_STEPS, '1/4', rateOf);
    // an amount of an octave: a share of the 11.6 octaves of 1/32..100 Hz
    const octave = 1 / Math.log2(3200);
    expect(travel(position + octave)).toBeCloseTo(shareOf(RATE_STEPS, '1/8'), 12);
    expect(travel(position - 2 * octave)).toBeCloseTo(shareOf(RATE_STEPS, '1 bar'), 12);
    // half an octave: halfway to the next step
    const half = (shareOf(RATE_STEPS, '1/4') + shareOf(RATE_STEPS, '1/8')) / 2;
    expect(travel(position + octave / 2)).toBeCloseTo(half, 12);
  });

  it('moves Delay and Rise by the share of the pow travel of 32 s: +25% from Off is 125 ms, a 16th at 120', () => {
    const { position, travel } = travelOf('lfo1.rise', TIME_DIVISIONS, 'Off', divisionSeconds);
    expect(position).toBe(0);
    expect(travel(0.25)).toBeCloseTo(shareOf(TIME_DIVISIONS, '1/16'), 12);
    expect(travel(-0.25)).toBe(0);
  });

  it('keeps a step past the travel of HZ on its step: 32 bars are 64 s at 120, the routes up stop there', () => {
    const { position, travel } = travelOf('lfo1.delay', TIME_DIVISIONS, '32 bar', divisionSeconds);
    expect(position).toBeCloseTo(Math.sqrt(Math.sqrt(2)), 12);
    expect(travel(position)).toBe(1);
    expect(travel(position + 0.1)).toBe(1);
    // the end of the travel of HZ: 32 s, 16 bars
    expect(travel(1)).toBeCloseTo(shareOf(TIME_DIVISIONS, '16 bar'), 12);
  });

  it('keeps a knob on its own step among steps of one value: 1/2 and 1 bar of the delay are both 4 s at 30 BPM', () => {
    const steps = delayDivisions(false, false);
    const at = (division: string) => travelOf('delay.time', steps, division, delayDivisionSeconds, 30);
    const longest = at('1 bar');
    expect(longest.travel(longest.position)).toBe(1);
    const next = at('1/2');
    expect(next.position).toBe(longest.position);
    expect(next.travel(next.position)).toBeCloseTo(shareOf(steps, '1/2'), 12);
    // down from it as from the longest: off the run of one value at once
    expect(next.travel(next.position - 0.001)).toBeCloseTo(longest.travel(longest.position - 0.001), 12);
  });

  it('moves Time of the delay by seconds of its range in MS: 1/4 + 0.5 s is 1/2 at 120', () => {
    const steps = delayDivisions(false, false);
    const { position, travel } = travelOf('delay.time', steps, '1/4', delayDivisionSeconds);
    // 0.01..1 s
    expect(travel(position + 0.5 / 0.99)).toBeCloseTo(shareOf(steps, '1/2'), 12);
  });
});
