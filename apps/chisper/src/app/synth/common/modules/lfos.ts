import {
  asyncScheduler,
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  Subject,
  throttleTime,
} from 'rxjs';
import { isEqual } from 'lodash';
import { ObjectBS, rxModel, rxModelReact } from '@chisper/rxjs-react';
import {
  DIVISION_MAX,
  divisionSeconds,
  divisionWithin,
  ENVELOPE_CURVE_MAX,
  ENVELOPE_TIME_MAX,
  envelopeCurve,
  LFO_DEFAULTS,
  LFO_KEYS,
  LFO_MODES,
  LFO_POINTS_MAX,
  LFO_RATE_MAX,
  LFO_RATE_MIN,
  LFO_SHAPES,
  LFO_SMOOTH_MAX,
  LfoId,
  LfoKnob,
  LfoMode,
  LfoPoint,
  LFOS,
  LfoShape,
  LfoSync,
  nearestDivision,
  quartersOf,
  rateDivisions,
  TEMPO_DIVISIONS,
  TIME_DIVISIONS,
} from '@chisper/preset-schema';
import { urlSnapshotPlugin } from '../../../app';
import {
  createLfoGlobal,
  frac,
  FREE,
  LfoAnchor,
  LFO_LEAD,
  LFO_STATE_INTERVAL,
  LfoGlobal,
  LfosState,
  lfoTable,
  LfoWire,
  nextAnchor,
  phaseAt,
  RETRIG,
} from '../lfo/lfo-curve';
import { SynthCoreModule } from './synth-core';
import { TransportModule } from './transport';

interface Deps {
  synthCore: SynthCoreModule;
  transport: TransportModule;
}

// the knobs of an LFO: rate is its period (seconds, the knob goes by its frequency), the times seconds, phase a
// share of the cycle; points: a shape of its own (before `shape`; the chart of the section edits it); in BPM Rate,
// Delay and Rise are divisions at the tempo (LfoSync)
export type LfoParams = Record<LfoKnob, number> &
  LfoSync & { shape: LfoShape; mode: LfoMode; points?: LfoPoint[] };
// the knobs that take a division in BPM, and the key of the division of each
export type LfoTimeKnob = 'rate' | 'delay' | 'rise';
export const DIVISION_KEYS: Record<LfoTimeKnob, 'div' | 'delayDiv' | 'riseDiv'> = {
  rate: 'div',
  delay: 'delayDiv',
  rise: 'riseDiv',
};
// the steps of a knob in BPM, from the shortest (Rate by TRIP and DOT)
export const divisionsOf = (knob: LfoTimeKnob, { trip, dot }: Pick<LfoSync, 'trip' | 'dot'>) =>
  knob === 'rate' ? rateDivisions(trip, dot) : TIME_DIVISIONS;
export type Lfos = Record<LfoId, LfoParams>;

const KNOB_RANGES: Record<LfoKnob, [number, number]> = {
  rate: [LFO_RATE_MIN, LFO_RATE_MAX],
  delay: [0, ENVELOPE_TIME_MAX],
  rise: [0, ENVELOPE_TIME_MAX],
  smooth: [0, LFO_SMOOTH_MAX],
  phase: [0, 1],
};
const KNOBS = Object.keys(KNOB_RANGES) as LfoKnob[];

// points of a snapshot, as the schema takes them (a url snapshot skips presetDataSchema): 2..LFO_POINTS_MAX of
// [x, y, k] within their ranges, from 0 up; else none
const pointsFrom = (value: unknown): LfoPoint[] | undefined => {
  if (!Array.isArray(value) || value.length < 2 || value.length > LFO_POINTS_MAX) return undefined;
  const points = value.map((point): LfoPoint | null => {
    if (!Array.isArray(point) || point.length !== 3 || !point.every((v) => typeof v === 'number'))
      return null;
    const [x, y, k] = point as number[];
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1 && Math.abs(k) <= ENVELOPE_CURVE_MAX)) return null;
    return [x, y, envelopeCurve(k)];
  });
  if (points.some((point) => point === null)) return undefined;
  const valid = points as LfoPoint[];
  return valid[0][0] === 0 && valid.every((point, i) => i === 0 || point[0] >= valid[i - 1][0])
    ? valid
    : undefined;
};

// an LFO of a snapshot: a missing knob is its default, 0 is kept; numbers within their ranges, a shape and a mode
// it knows, else the default
const lfoFrom = (snap: unknown): LfoParams => {
  const values = (typeof snap === 'object' && snap !== null ? snap : {}) as Record<string, unknown>;
  const knobs = Object.fromEntries(
    KNOBS.map((knob) => {
      const value = values[knob];
      const [min, max] = KNOB_RANGES[knob];
      return [
        knob,
        typeof value === 'number' && !Number.isNaN(value)
          ? Math.min(max, Math.max(min, value))
          : LFO_DEFAULTS[knob],
      ];
    })
  ) as Record<LfoKnob, number>;
  const shape = LFO_SHAPES.includes(values['shape'] as LfoShape)
    ? (values['shape'] as LfoShape)
    : LFO_DEFAULTS.shape;
  const mode = LFO_MODES.includes(values['mode'] as LfoMode)
    ? (values['mode'] as LfoMode)
    : LFO_DEFAULTS.mode;
  const flag = (key: 'bpm' | 'trip' | 'dot' | 'host') =>
    typeof values[key] === 'boolean' ? (values[key] as boolean) : LFO_DEFAULTS[key];
  const sync = { bpm: flag('bpm'), trip: flag('trip'), dot: flag('dot'), host: flag('host') };
  // a division of the steps of its knob (one of a url out of them: the nearest)
  const division = (knob: LfoTimeKnob) => {
    const key = DIVISION_KEYS[knob];
    const value = values[key];
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= DIVISION_MAX
      ? divisionWithin(value as number, divisionsOf(knob, sync))
      : LFO_DEFAULTS[key];
  };
  const divisions = { div: division('rate'), delayDiv: division('delay'), riseDiv: division('rise') };
  const points = pointsFrom(values['points']);
  const lfo = { ...knobs, ...sync, ...divisions, shape, mode };
  return points ? { ...lfo, points } : lfo;
};

const lfosFrom = (snap: Record<string, unknown>) =>
  Object.fromEntries(LFOS.map((id) => [id, lfoFrom(snap[LFO_KEYS[id]])])) as Lfos;

// a division of Rate as long as LFO_RATE_MIN at least at a tempo (within a rounding: 1/128 at 187.5 BPM is 10 ms)
const fits = (division: number, bpm: number) => divisionSeconds(division, bpm) >= LFO_RATE_MIN * (1 - 1e-9);
// the steps of Rate at a tempo, from the shortest: those of TRIP and DOT as long as LFO_RATE_MIN at least there
// (1/256 is shorter above 93.75 BPM, 1/256T above 62.5); the same steps are the same array (a memoized knob, the
// travel of its routes). 32 bars always fit
const RATE_STEPS = new Map<string, number[]>();
export const rateStepsAt = ({ trip, dot }: Pick<LfoSync, 'trip' | 'dot'>, bpm: number) => {
  const steps = rateDivisions(trip, dot);
  const first = Math.max(
    0,
    steps.findIndex((division) => fits(division, bpm))
  );
  const key = `${+trip}${+dot}${first}`;
  const cached = RATE_STEPS.get(key);
  if (cached) return cached;
  const fitting = steps.slice(first);
  RATE_STEPS.set(key, fitting);
  return fitting;
};
// the division Rate plays at a tempo: its own, else (shorter than LFO_RATE_MIN there) the shortest of its steps
// there; the preset keeps its own (a slower tempo plays it again)
export const lfoDivision = (lfo: Pick<LfoSync, 'div' | 'trip' | 'dot'>, bpm: number) =>
  fits(lfo.div, bpm) ? lfo.div : rateStepsAt(lfo, bpm)[0];

// the seconds of Rate, Delay and Rise the LFO plays: in BPM of their divisions at the tempo (Rate the division it
// plays there: LFO_RATE_MIN at least)
export const lfoSeconds = (lfo: LfoParams, bpm: number): Record<LfoTimeKnob, number> =>
  lfo.bpm
    ? {
        rate: divisionSeconds(lfoDivision(lfo, bpm), bpm),
        delay: divisionSeconds(lfo.delayDiv, bpm),
        rise: divisionSeconds(lfo.riseDiv, bpm),
      }
    : { rate: lfo.rate, delay: lfo.delay, rise: lfo.rise };

// the bounds of the routes to the knobs of the LFOs in BPM at a tempo, by target (lfo1.rate…): Rate from the
// longest to the shortest of its steps there (by the frequency), Delay and Rise up to 32 bars; those of the others
// are the ranges of their knobs (modulation-targets.ts)
export type LfoRanges = Partial<Record<string, [number, number]>>;
export const lfoRanges = (lfos: Lfos, bpm: number): LfoRanges =>
  Object.fromEntries(
    LFOS.flatMap((id) => {
      const lfo = lfos[id];
      if (!lfo.bpm) return [];
      const steps = rateStepsAt(lfo, bpm);
      const longest = divisionSeconds(steps[steps.length - 1], bpm);
      const shortest = divisionSeconds(steps[0], bpm);
      const times: [number, number] = [0, divisionSeconds(TIME_DIVISIONS[TIME_DIVISIONS.length - 1], bpm)];
      return [
        [`${id}.rate`, [1 / longest, 1 / shortest]],
        [`${id}.delay`, times],
        [`${id}.rise`, times],
      ];
    })
  );

// the same phase modulo 1 (within 1e-9: the clock of an anchor worked out again)
const samePhase = (a: number, b: number) => {
  const d = frac(a - b);
  return Math.min(d, 1 - d) < 1e-9;
};

const tableOf = ({ shape, points }: LfoParams) => lfoTable(shape, points);
const sameShape = (a: LfoParams, b: LfoParams) =>
  a.shape === b.shape && JSON.stringify(a.points) === JSON.stringify(b.points);

// the LFOs LFO 1–4, sources of the routes: the voices node runs one per note of each (the oscillators and the
// filter), the fx worklets and the main thread one for the last note (the fx, the marks of the knobs). Every
// change goes to them as a state from now + LFO_LEAD on (LfosState): the knobs, the newest anchor of each clock (a
// new period: an anchor there, the phase goes on) and the tables of the shapes that changed, at most every
// LFO_STATE_INTERVAL (the first change at once, the last one after it: a drag of a point or a knob posts 50 states
// a second at most, to five threads, each a table of 8 KB when it is a shape). In BPM the seconds are those of the
// divisions at the tempo of the transport: a new tempo is a state of those in BPM from its segment on (a period of
// its own, the phase goes on); a free one with HOST is on the grid of the beats (its phase the share of its
// division since beat 0: a new Rate may step it), in HZ it takes the position of the transport where it moves (a
// MIDI Start). `globals` are the LFOs as they run on the main thread, `$state` the last state with every table (an
// fx worklet made later starts with it), `$ranges` the bounds of the routes to their knobs in BPM. The tab of the
// section (`$selected`) is the state of the UI, not in the preset
export const lfos = ({ synthCore: [{ audioCtx, wavetables }], transport: [transport] }: Deps) =>
  rxModel(() => {
    const $lfos = new ObjectBS<Lfos>(lfosFrom({}));
    const $selected = new BehaviorSubject<LfoId>(LFOS[0]);
    const globals = Object.fromEntries(LFOS.map((id) => [id, createLfoGlobal()])) as Record<LfoId, LfoGlobal>;
    const $state = new BehaviorSubject<LfosState | null>(null);
    // every state as it is sent (the tables only of the shapes that changed)
    const $changes = new Subject<LfosState>();
    const $ranges = new BehaviorSubject<LfoRanges>(lfoRanges($lfos.value, transport.$tempo.value));
    return { $lfos, $selected, globals, $state, $changes, $ranges };
  })
    .actions(({ $lfos, $selected }) => {
      const update = (id: LfoId, change: Partial<LfoParams>) =>
        $lfos.next({ ...$lfos.value, [id]: { ...$lfos.value[id], ...change } });
      return {
        setLfoValue: (id: LfoId, key: LfoKnob, value: number) => update(id, { [key]: value }),
        // a shape chosen replaces points of its own
        setShape: (id: LfoId, shape: LfoShape) => {
          const { points: _, ...lfo } = $lfos.value[id];
          $lfos.next({ ...$lfos.value, [id]: { ...lfo, shape } });
        },
        // a shape of its own (none: its shape again)
        setPoints: (id: LfoId, points: LfoPoint[] | undefined) => {
          const { points: _, ...lfo } = $lfos.value[id];
          const valid = pointsFrom(points);
          $lfos.next({ ...$lfos.value, [id]: valid ? { ...lfo, points: valid } : lfo });
        },
        setMode: (id: LfoId, mode: LfoMode) => update(id, { mode }),
        // BPM: each knob of a time takes the division nearest to its seconds at the tempo (Rate of its steps
        // there); HZ: the seconds of its division as it plays (within the range of its knob)
        setBpm: (id: LfoId, bpm: boolean) => {
          const lfo = $lfos.value[id];
          if (lfo.bpm === bpm) return;
          const tempo = transport.$tempo.value;
          if (bpm) {
            const nearest = (knob: LfoTimeKnob) =>
              nearestDivision(
                quartersOf(lfo[knob], tempo),
                knob === 'rate' ? rateStepsAt(lfo, tempo) : divisionsOf(knob, lfo)
              );
            update(id, { bpm, div: nearest('rate'), delayDiv: nearest('delay'), riseDiv: nearest('rise') });
            return;
          }
          const within = (value: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, value));
          const seconds = lfoSeconds(lfo, tempo);
          update(id, {
            bpm,
            rate: within(seconds.rate, KNOB_RANGES.rate),
            delay: within(seconds.delay, KNOB_RANGES.delay),
            rise: within(seconds.rise, KNOB_RANGES.rise),
          });
        },
        // a division of Rate, Delay or Rise (one of the steps of the knob, else the nearest)
        setDivision: (id: LfoId, knob: LfoTimeKnob, division: number) =>
          update(id, { [DIVISION_KEYS[knob]]: divisionWithin(division, divisionsOf(knob, $lfos.value[id])) }),
        // TRIP and DOT: the triplets and the dotted ones on the steps of Rate; one switched off takes the straight
        // one of the division of Rate it has
        setTrip: (id: LfoId, trip: boolean) => {
          const lfo = $lfos.value[id];
          update(id, { trip, div: divisionWithin(lfo.div, rateDivisions(trip, lfo.dot)) });
        },
        setDot: (id: LfoId, dot: boolean) => {
          const lfo = $lfos.value[id];
          update(id, { dot, div: divisionWithin(lfo.div, rateDivisions(lfo.trip, dot)) });
        },
        setHost: (id: LfoId, host: boolean) => update(id, { host }),
        select: (id: LfoId) => $selected.next(id),
      };
    })
    .subscriptions(({ $lfos, globals, $state, $changes, $ranges }) => {
      // the knobs last sent
      let previous: Lfos | null = null;
      const tables = {} as Record<LfoId, Float32Array>;
      // the anchor of the clock of an LFO from `at` on at `period`: a free one with HOST in BPM on the grid of the
      // beats of the division it plays (the newest one if it is there already), in HZ from the position of the
      // transport when it moved (locate); else the newest one at the same period, or one where the phase goes on
      const anchorOf = (lfo: LfoParams, global: LfoGlobal, at: number, period: number, locate: boolean) => {
        const { anchors } = global;
        const newest = anchors[anchors.length - 1];
        if (lfo.mode === 'free' && lfo.host && (lfo.bpm || locate)) {
          const beat = transport.beatAt(at);
          const tempo = transport.tempoAt(at);
          const phase = lfo.bpm
            ? frac(beat / TEMPO_DIVISIONS[lfoDivision(lfo, tempo)].quarters)
            : frac((beat * 60) / tempo / period);
          if (newest.period === period && samePhase(phaseAt(anchors, at), phase)) return newest;
          return { time: at, phase, period } as LfoAnchor;
        }
        return period === newest.period ? newest : nextAnchor(anchors, at, period);
      };
      const send = (next: Lfos, at: number, locate = false) => {
        const before = previous;
        previous = next;
        const tempo = transport.tempoAt(at);
        const wires = LFOS.map((id): LfoWire => {
          const lfo = next[id];
          const global = globals[id];
          const seconds = lfoSeconds(lfo, tempo);
          const anchor = anchorOf(lfo, global, at, seconds.rate, locate);
          const changed = !before || !sameShape(before[id], lfo);
          if (changed) tables[id] = tableOf(lfo);
          const wire: LfoWire = {
            mode: lfo.mode === 'free' ? FREE : RETRIG,
            delay: seconds.delay,
            rise: seconds.rise,
            smooth: lfo.smooth,
            phase: lfo.phase,
            anchor,
            ...(changed && { table: tables[id] }),
          };
          // the first state is there at once
          global.set(at, wire, !before);
          return wire;
        });
        wavetables.setLfos({ at, lfos: wires });
        $state.next({ at, lfos: wires.map((wire, i) => ({ ...wire, table: tables[LFOS[i]] })) });
        $changes.next({ at, lfos: wires });
      };
      return [
        $lfos
          .pipe(throttleTime(LFO_STATE_INTERVAL * 1000, asyncScheduler, { leading: true, trailing: true }))
          .subscribe((next) => send(next, audioCtx.currentTime + LFO_LEAD)),
        // a new tempo: the LFOs in BPM from its segment on; the transport moved: those on its grid (HOST, free)
        transport.$changes.subscribe(({ segment, locate }) => {
          const sent = previous;
          if (!sent) return;
          const moved = LFOS.some((id) => {
            const lfo = sent[id];
            return lfo.bpm || (locate && lfo.host && lfo.mode === 'free');
          });
          if (moved) send(sent, segment.time, locate);
        }),
        combineLatest([$lfos, transport.$tempo])
          .pipe(
            map(([lfos, bpm]) => lfoRanges(lfos, bpm)),
            distinctUntilChanged(isEqual)
          )
          .subscribe($ranges),
      ];
    })
    .plugins(
      urlSnapshotPlugin({
        // lfo: { l1, l2, l3, l4 }, each { rate, delay, rise, smooth, phase, shape, mode, points?, bpm, div, trip,
        // dot, host, delayDiv, riseDiv }
        modelToSnap: ({ $lfos }) =>
          Object.fromEntries(LFOS.map((id) => [LFO_KEYS[id], $lfos.value[id]])) as Record<string, LfoParams>,
        applySnap: (snap, { $lfos }) => $lfos.next(lfosFrom(snap)),
      })
    );

export const {
  ModelProvider: LfoProvider,
  useModel: useLfos,
  Context: LfoContext,
} = rxModelReact('lfo', lfos);

export type LfoModule = ReturnType<typeof useLfos>;
