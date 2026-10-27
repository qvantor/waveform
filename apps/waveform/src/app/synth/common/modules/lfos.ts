import { BehaviorSubject } from 'rxjs';
import { ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import {
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
} from '@waveform/preset-schema';
import { urlSnapshotPlugin } from '../../../app';
import {
  createLfoGlobal,
  FREE,
  LFO_LEAD,
  LfoGlobal,
  LfosState,
  lfoTable,
  LfoWire,
  nextAnchor,
  RETRIG,
} from '../lfo/lfo-curve';
import { SynthCoreModule } from './synth-core';

interface Deps {
  synthCore: SynthCoreModule;
}

// the knobs of an LFO: rate is its period (seconds, the knob goes by its frequency), the times seconds, phase a
// share of the cycle; points: a shape of its own (before `shape`; no editor draws it yet)
export type LfoParams = Record<LfoKnob, number> & { shape: LfoShape; mode: LfoMode; points?: LfoPoint[] };
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
  const points = pointsFrom(values['points']);
  return points ? { ...knobs, shape, mode, points } : { ...knobs, shape, mode };
};

const lfosFrom = (snap: Record<string, unknown>) =>
  Object.fromEntries(LFOS.map((id) => [id, lfoFrom(snap[LFO_KEYS[id]])])) as Lfos;

const tableOf = ({ shape, points }: LfoParams) => lfoTable(shape, points);
const sameShape = (a: LfoParams, b: LfoParams) =>
  a.shape === b.shape && JSON.stringify(a.points) === JSON.stringify(b.points);

// the LFOs LFO 1–4, sources of the routes: the voices node runs one per note of each (the oscillators and the
// filter), the fx worklets and the main thread one for the last note (the fx, the marks of the knobs). Every
// change goes to them as a state from now + LFO_LEAD on (LfosState): the knobs, the newest anchor of each clock (a
// new period: an anchor there, the phase goes on) and the tables of the shapes that changed. `globals` are the
// LFOs as they run on the main thread, `$state` the last state with every table (an fx worklet made later starts
// with it). The tab of the section (`$selected`) is the state of the UI, not in the preset
export const lfos = ({ synthCore: [{ audioCtx, wavetables }] }: Deps) =>
  rxModel(() => {
    const $lfos = new ObjectBS<Lfos>(lfosFrom({}));
    const $selected = new BehaviorSubject<LfoId>(LFOS[0]);
    const globals = Object.fromEntries(LFOS.map((id) => [id, createLfoGlobal()])) as Record<LfoId, LfoGlobal>;
    const $state = new BehaviorSubject<LfosState | null>(null);
    return { $lfos, $selected, globals, $state };
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
        select: (id: LfoId) => $selected.next(id),
      };
    })
    .subscriptions(({ $lfos, globals, $state }) => {
      let previous: Lfos | null = null;
      const tables = {} as Record<LfoId, Float32Array>;
      return [
        $lfos.subscribe((next) => {
          const at = audioCtx.currentTime + LFO_LEAD;
          const before = previous;
          previous = next;
          const wires = LFOS.map((id): LfoWire => {
            const lfo = next[id];
            const global = globals[id];
            const { anchors } = global;
            const newest = anchors[anchors.length - 1];
            const anchor = lfo.rate === newest.period ? newest : nextAnchor(anchors, at, lfo.rate);
            const changed = !before || !sameShape(before[id], lfo);
            if (changed) tables[id] = tableOf(lfo);
            const wire: LfoWire = {
              mode: lfo.mode === 'free' ? FREE : RETRIG,
              delay: lfo.delay,
              rise: lfo.rise,
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
        }),
      ];
    })
    .plugins(
      urlSnapshotPlugin({
        // lfo: { l1, l2, l3, l4 }, each { rate, delay, rise, smooth, phase, shape, mode, points? }
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
