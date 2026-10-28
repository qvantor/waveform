import type { LfosState } from '../../common/lfo/lfo-curve';
import {
  createNoteLfos,
  FxNote,
  FxRoute,
  isLfoSource,
  LFO_SOURCE,
  movedBy,
  noteLevel,
  routeTerm,
} from './fx-modulation';
import { FX_MOD_LINES, FxModLine, FxModOptions, mapKnob } from './fx-mod-params';

// the lines of the fx-mod worklet (fx-mod.worklet.ts; the specs run it in Node): each line the offset its routes
// move a param by from its knob (fx-mod-params.ts), worked out at points every 32 samples of a block and its last
// sample, linear between them; the envelopes and VELO of the last note, the LFOs of the note on their clocks (also
// without a note). A change (a route, a knob, a new note) glides from where the line was to where it goes in
// FX_MOD_GLIDE: no step; a line gone goes to 0 so, then it is idle (its output 0, the main thread disconnects it)

// seconds a change glides in
export const FX_MOD_GLIDE = 0.01;
const SEGMENT = 32;
const LFOS = 4;

interface Line {
  line: FxModLine | null;
  // the offset of its last sample, the difference to its target the glide starts from (NaN: worked out at the next
  // block), the samples of the glide done (Infinity: none)
  last: number;
  from: number;
  done: number;
  idle: boolean;
}

const clampTo = (value: number, { min, max }: FxRoute) => Math.min(max, Math.max(min, value));

export const createFxModLines = (sampleRate: number, options?: FxModOptions) => {
  const glide = Math.max(1, Math.round(FX_MOD_GLIDE * sampleRate));
  const lfos = createNoteLfos(sampleRate);
  let note: FxNote | null = null;
  const lines = Array.from(
    { length: FX_MOD_LINES },
    (): Line => ({ line: null, last: 0, from: 0, done: Infinity, idle: true })
  );
  const start = (line: Line) => {
    line.from = NaN;
    line.done = 0;
  };

  const setLine = (index: number, line: FxModLine | null) => {
    const entry = lines[index];
    if (!entry || (!line && entry.idle)) return;
    entry.line = line;
    entry.idle = false;
    start(entry);
  };
  const setNote = (next: FxNote | null) => {
    note = next;
    lfos.follow(next);
    lines.forEach((line) => !line.idle && start(line));
  };
  if (options) {
    if (options.lfos) lfos.setLfos(options.lfos);
    lfos.setRoutes(options.knobRoutes);
    note = options.note;
    lfos.follow(options.note);
    options.lines.forEach((line, index) => {
      if (!line || !lines[index]) return;
      lines[index].line = line;
      lines[index].idle = false;
    });
  }

  // the points of a block of n (made again only for another n), the levels of the LFOs the lines read at them
  // (worked out once a block, in order)
  let points: number[] = [];
  let pointsOf = 0;
  const levels = Array.from({ length: LFOS }, () => new Float64Array(SEGMENT));
  const used = new Array<boolean>(LFOS);

  // the offset of a line at point j of the block at `frame` (no closure a point: the audio thread makes no garbage)
  const offset = ({ routes, base, map }: FxModLine, frame: number, j: number) => {
    const t = (frame + points[j]) / sampleRate;
    let sum = 0;
    for (let r = 0; r < routes.length; r++) {
      const route = routes[r];
      const level = isLfoSource(route.source)
        ? levels[route.source - LFO_SOURCE][j]
        : note
        ? noteLevel(note, route.source, t - note.start)
        : 0;
      sum += routeTerm(route, level);
    }
    return mapKnob(map, clampTo(movedBy(base, sum, routes[0]), routes[0])) - mapKnob(map, base);
  };

  return {
    setLine,
    setNote,
    setKnobRoutes: (routes: FxRoute[]) => lfos.setRoutes(routes),
    setLfos: (state: LfosState) => lfos.setLfos(state),
    // a block of the length of the outputs at `frame` into them (one channel each); while every line is idle only
    // zeros (a line gone is connected until fx-mod disconnects it). No closure and no array a block or a point: the
    // audio thread makes no garbage
    process: (frame: number, outputs: Float32Array[]) => {
      const n = outputs[0]?.length ?? 0;
      if (n === 0) return;
      let idle = true;
      for (let k = 0; k < lines.length; k++) if (!lines[k].idle) idle = false;
      if (idle) {
        for (let k = 0; k < outputs.length; k++) outputs[k].fill(0);
        return;
      }
      if (pointsOf !== n) {
        points = [];
        for (let p = 0; ; p = Math.min(p + SEGMENT, n - 1)) {
          points.push(p);
          if (p === n - 1) break;
        }
        pointsOf = n;
      }
      used.fill(false);
      for (let k = 0; k < lines.length; k++) {
        const { line } = lines[k];
        if (lines[k].idle || !line) continue;
        for (let r = 0; r < line.routes.length; r++) {
          const { source } = line.routes[r];
          if (isLfoSource(source)) used[source - LFO_SOURCE] = true;
        }
      }
      for (let i = 0; i < LFOS; i++) {
        if (!used[i]) continue;
        if (levels[i].length < points.length) levels[i] = new Float64Array(points.length);
        for (let j = 0; j < points.length; j++) levels[i][j] = lfos.level(i, frame + points[j]);
      }
      for (let k = 0; k < lines.length; k++) {
        const entry = lines[k];
        const out = outputs[k];
        if (!out) continue;
        if (entry.idle) {
          out.fill(0);
          continue;
        }
        const { line } = entry;
        // the target at the points, linear between them
        let previous = line ? offset(line, frame, 0) : 0;
        out[0] = previous;
        for (let j = 1; j < points.length; j++) {
          const value = line ? offset(line, frame, j) : 0;
          const a = points[j - 1];
          const b = points[j];
          for (let i = a + 1; i <= b; i++) out[i] = previous + ((value - previous) * (i - a)) / (b - a);
          previous = value;
        }
        if (entry.done < glide) {
          if (Number.isNaN(entry.from)) entry.from = entry.last - out[0];
          for (let i = 0; i < n; i++) out[i] += entry.from * Math.max(0, 1 - (entry.done + i) / glide);
          entry.done += n;
        }
        entry.last = out[n - 1];
        if (!line && entry.done >= glide) {
          entry.idle = true;
          entry.last = 0;
        }
      }
    },
    // a line outputs nothing (gone and at 0)
    idle: (index: number) => lines[index]?.idle ?? true,
  };
};
