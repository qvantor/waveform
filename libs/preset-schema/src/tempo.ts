// the tempo of the synth: beats (quarter notes) a minute, global (the browser keeps it), not in a preset
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 300;
export const TEMPO_DEFAULT = 120;
// the tempo on the grid of its field (steps of 0.01) within its range; NaN: the default
export const tempoOf = (bpm: number) =>
  Number.isFinite(bpm)
    ? Math.round(Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm)) * 100) / 100
    : bpm === Infinity
    ? TEMPO_MAX
    : bpm === -Infinity
    ? TEMPO_MIN
    : TEMPO_DEFAULT;

// a length of a note the times of the LFOs, the envelopes and the delay take in their BPM mode: quarters of a
// bar of 4/4, straight, a triplet (2/3 of it) or dotted (1.5 of it); off is no time at all
export type DivisionKind = 'off' | 'straight' | 'triplet' | 'dotted';
export interface TempoDivision {
  id: string;
  quarters: number;
  kind: DivisionKind;
  // quarters of the straight one it varies
  of: number;
}

const STRAIGHT: [string, number][] = [
  ['32 bar', 128],
  ['16 bar', 64],
  ['8 bar', 32],
  ['4 bar', 16],
  ['2 bar', 8],
  ['1 bar', 4],
  ['1/2', 2],
  ['1/4', 1],
  ['1/8', 1 / 2],
  ['1/16', 1 / 4],
  ['1/32', 1 / 8],
  ['1/64', 1 / 16],
  ['1/128', 1 / 32],
  ['1/256', 1 / 64],
];
// '1/8T', '2 bar T'
const variant = (id: string, suffix: string) => (id.includes('bar') ? `${id} ${suffix}` : `${id}${suffix}`);

// the divisions: a preset keeps the index of one, so the list is only appended to (as DISTORTION_MODES)
export const TEMPO_DIVISIONS: readonly TempoDivision[] = [
  { id: 'Off', quarters: 0, kind: 'off', of: 0 },
  ...STRAIGHT.map(([id, quarters]): TempoDivision => ({ id, quarters, kind: 'straight', of: quarters })),
  ...STRAIGHT.map(
    ([id, quarters]): TempoDivision => ({
      id: variant(id, 'T'),
      quarters: (quarters * 2) / 3,
      kind: 'triplet',
      of: quarters,
    })
  ),
  ...STRAIGHT.map(
    ([id, quarters]): TempoDivision => ({
      id: variant(id, 'D'),
      quarters: quarters * 1.5,
      kind: 'dotted',
      of: quarters,
    })
  ),
  // appended after them: the shortest step of the envelopes (3.9 ms at 120)
  { id: '1/512', quarters: 1 / 128, kind: 'straight', of: 1 / 128 },
];
export const DIVISION_OFF = 0;
export const DIVISION_MAX = TEMPO_DIVISIONS.length - 1;

// the index of a division by its id (-1: none)
export const divisionIndex = (id: string) => TEMPO_DIVISIONS.findIndex((division) => division.id === id);

// seconds of a division at a tempo (0: off or none)
export const divisionSeconds = (index: number, bpm: number) =>
  ((TEMPO_DIVISIONS[index]?.quarters ?? 0) * 60) / bpm;

// quarters of `seconds` at a tempo
export const quartersOf = (seconds: number, bpm: number) => (seconds * bpm) / 60;

interface StepsOptions {
  // the ids of the longest and the shortest straight division of the steps
  longest: string;
  shortest: string;
  // the triplets and the dotted of those
  trip?: boolean;
  dot?: boolean;
  // Off before them
  off?: boolean;
}
// the divisions a knob steps through, from the shortest: the straight ones from `shortest` to `longest`, their
// triplets and dotted ones as asked, Off first
export const divisionSteps = ({
  longest,
  shortest,
  trip = false,
  dot = false,
  off = false,
}: StepsOptions) => {
  const [low, high] = [TEMPO_DIVISIONS[divisionIndex(shortest)], TEMPO_DIVISIONS[divisionIndex(longest)]];
  const kinds: DivisionKind[] = [
    'straight',
    ...(trip ? ['triplet' as const] : []),
    ...(dot ? ['dotted' as const] : []),
  ];
  const steps = TEMPO_DIVISIONS.map((division, index) => ({ division, index }))
    .filter(({ division: { kind, of } }) => kinds.includes(kind) && of >= low.quarters && of <= high.quarters)
    .map(({ index }) => index)
    .sort((a, b) => TEMPO_DIVISIONS[a].quarters - TEMPO_DIVISIONS[b].quarters);
  return off ? [DIVISION_OFF, ...steps] : steps;
};

// the step nearest to a length of `quarters` (by their ratio: a step twice as long is as far as one half as
// long): Off only for none at all (or a step that has nothing else)
export const nearestDivision = (quarters: number, steps: readonly number[]) => {
  const timed = steps.filter((index) => TEMPO_DIVISIONS[index].quarters > 0);
  if ((!(quarters > 0) && steps.includes(DIVISION_OFF)) || timed.length === 0) return steps[0];
  if (!(quarters > 0)) return timed[0];
  const distance = (index: number) => Math.abs(Math.log(TEMPO_DIVISIONS[index].quarters / quarters));
  return timed.reduce((best, index) => (distance(index) < distance(best) ? index : best));
};

// a division as one of `steps`: itself if it is one, else the straight one it varies (TRIP or DOT off: 1/4T is
// 1/4), else the nearest of them
export const divisionWithin = (index: number, steps: readonly number[]) => {
  if (steps.includes(index)) return index;
  const division = TEMPO_DIVISIONS[index];
  if (!division) return nearestDivision(0, steps);
  const straight = TEMPO_DIVISIONS.findIndex(
    ({ kind, quarters }) => kind === 'straight' && quarters === division.of
  );
  return steps.includes(straight) ? straight : nearestDivision(division.quarters, steps);
};

// the steps of the times of the envelopes: Off, then 1/512 … 32 bar
export const ENVELOPE_TIME_DIVISIONS = divisionSteps({ longest: '32 bar', shortest: '1/512', off: true });
// the steps of Delay and Rise of an LFO: Off, then 1/256 … 32 bar
export const TIME_DIVISIONS = divisionSteps({ longest: '32 bar', shortest: '1/256', off: true });
// the steps of Rate of an LFO: 1/256 … 32 bar, with TRIP and DOT their triplets and dotted ones
export const rateDivisions = (trip: boolean, dot: boolean) =>
  divisionSteps({ longest: '32 bar', shortest: '1/256', trip, dot });
// the steps of Time of the delay: 1/64 … 1 bar, with TRIP and DOT their triplets and dotted ones
export const delayDivisions = (trip: boolean, dot: boolean) =>
  divisionSteps({ longest: '1 bar', shortest: '1/64', trip, dot });
