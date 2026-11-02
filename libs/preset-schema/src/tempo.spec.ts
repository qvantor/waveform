import {
  delayDivisions,
  DIVISION_OFF,
  divisionIndex,
  divisionSeconds,
  divisionSteps,
  divisionWithin,
  nearestDivision,
  quartersOf,
  rateDivisions,
  TEMPO_DEFAULT,
  TEMPO_DIVISIONS,
  TEMPO_MAX,
  TEMPO_MIN,
  tempoOf,
  TIME_DIVISIONS,
} from './tempo';

const ids = (steps: number[]) => steps.map((index) => TEMPO_DIVISIONS[index].id);
const at = (id: string) => divisionIndex(id);

describe('tempo', () => {
  it('keeps the tempo on the grid of 0.01 within its range', () => {
    expect([TEMPO_MIN, TEMPO_DEFAULT, TEMPO_MAX]).toEqual([20, 120, 300]);
    expect(tempoOf(128.456)).toBe(128.46);
    expect(tempoOf(10)).toBe(20);
    expect(tempoOf(1000)).toBe(300);
    expect(tempoOf(Infinity)).toBe(300);
    expect(tempoOf(-Infinity)).toBe(20);
    expect(tempoOf(NaN)).toBe(120);
  });
});

describe('TEMPO_DIVISIONS', () => {
  it('has Off, the straight divisions from 32 bars to 1/256, then their triplets and dotted ones', () => {
    expect(TEMPO_DIVISIONS).toHaveLength(43);
    expect(TEMPO_DIVISIONS[DIVISION_OFF]).toEqual({ id: 'Off', quarters: 0, kind: 'off', of: 0 });
    expect(ids(TEMPO_DIVISIONS.slice(1, 15).map((_, i) => i + 1))).toEqual([
      '32 bar',
      '16 bar',
      '8 bar',
      '4 bar',
      '2 bar',
      '1 bar',
      '1/2',
      '1/4',
      '1/8',
      '1/16',
      '1/32',
      '1/64',
      '1/128',
      '1/256',
    ]);
    // the indexes a preset keeps: the list is only appended to
    expect([at('1/4'), at('1/8D'), at('1/16T'), at('2 bar T'), at('1 bar D')]).toEqual([8, 37, 24, 19, 34]);
  });

  it('is in quarters of a bar of 4/4: a triplet is 2/3 of the straight one, a dotted one 1.5', () => {
    expect(TEMPO_DIVISIONS[at('1 bar')].quarters).toBe(4);
    expect(TEMPO_DIVISIONS[at('1/8D')]).toEqual({ id: '1/8D', quarters: 0.75, kind: 'dotted', of: 0.5 });
    expect(TEMPO_DIVISIONS[at('2 bar T')]).toEqual({
      id: '2 bar T',
      quarters: 16 / 3,
      kind: 'triplet',
      of: 8,
    });
  });

  it('gives the seconds of a division at a tempo', () => {
    expect(divisionSeconds(at('1/4'), 120)).toBe(0.5);
    expect(divisionSeconds(at('1 bar'), 60)).toBe(4);
    expect(divisionSeconds(at('32 bar'), 20)).toBe(384);
    expect(divisionSeconds(at('1/8D'), 120)).toBe(0.375);
    expect(divisionSeconds(DIVISION_OFF, 120)).toBe(0);
    expect(divisionSeconds(99, 120)).toBe(0);
    expect(quartersOf(0.5, 120)).toBe(1);
  });
});

describe('divisionSteps', () => {
  it('steps from the shortest, Off first', () => {
    expect(ids(TIME_DIVISIONS)).toEqual([
      'Off',
      '1/256',
      '1/128',
      '1/64',
      '1/32',
      '1/16',
      '1/8',
      '1/4',
      '1/2',
      '1 bar',
      '2 bar',
      '4 bar',
      '8 bar',
      '16 bar',
      '32 bar',
    ]);
  });

  it('adds the triplets and the dotted ones of the straight ones in its range', () => {
    expect(ids(delayDivisions(false, false))).toEqual(['1/64', '1/32', '1/16', '1/8', '1/4', '1/2', '1 bar']);
    expect(ids(delayDivisions(true, false))).toEqual([
      '1/64T',
      '1/64',
      '1/32T',
      '1/32',
      '1/16T',
      '1/16',
      '1/8T',
      '1/8',
      '1/4T',
      '1/4',
      '1/2T',
      '1/2',
      '1 bar T',
      '1 bar',
    ]);
    expect(ids(delayDivisions(false, true)).slice(-3)).toEqual(['1/2D', '1 bar', '1 bar D']);
    expect(rateDivisions(false, false)).toHaveLength(14);
    expect(rateDivisions(true, true)).toHaveLength(42);
    expect(ids(divisionSteps({ longest: '1/4', shortest: '1/8', dot: true }))).toEqual([
      '1/8',
      '1/8D',
      '1/4',
      '1/4D',
    ]);
  });
});

describe('nearestDivision', () => {
  it('takes the step of the nearest ratio', () => {
    // 0.2 s at 120: 0.4 quarters, 1/8 is 1.25 times longer, 1/16 1.6 times shorter
    expect(nearestDivision(quartersOf(0.2, 120), TIME_DIVISIONS)).toBe(at('1/8'));
    expect(nearestDivision(quartersOf(0.2, 120), delayDivisions(true, false))).toBe(at('1/8T'));
    expect(nearestDivision(quartersOf(60, 120), TIME_DIVISIONS)).toBe(at('32 bar'));
    expect(nearestDivision(quartersOf(0.0001, 120), TIME_DIVISIONS)).toBe(at('1/256'));
  });

  it('is Off for no time, the shortest step without Off', () => {
    expect(nearestDivision(0, TIME_DIVISIONS)).toBe(DIVISION_OFF);
    expect(nearestDivision(0, rateDivisions(false, false))).toBe(at('1/256'));
    expect(nearestDivision(NaN, TIME_DIVISIONS)).toBe(DIVISION_OFF);
  });
});

describe('divisionWithin', () => {
  it('keeps a division of the steps, takes the straight one of a triplet or a dotted one it has not', () => {
    const straight = rateDivisions(false, false);
    expect(divisionWithin(at('1/4'), straight)).toBe(at('1/4'));
    expect(divisionWithin(at('1/4T'), straight)).toBe(at('1/4'));
    expect(divisionWithin(at('1/8D'), straight)).toBe(at('1/8'));
    expect(divisionWithin(at('1/8D'), rateDivisions(false, true))).toBe(at('1/8D'));
  });

  it('takes the nearest step for one out of its range', () => {
    expect(divisionWithin(at('32 bar'), delayDivisions(false, false))).toBe(at('1 bar'));
    expect(divisionWithin(DIVISION_OFF, delayDivisions(false, false))).toBe(at('1/64'));
    expect(divisionWithin(99, TIME_DIVISIONS)).toBe(DIVISION_OFF);
  });
});
