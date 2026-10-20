import React from 'react';
import { number } from '@waveform/math';
import { onFrame } from './frame-ticker';
import { liveRoutes, QUANTUM, Route, routedShare } from './mod-routes';
import { ScaleMode, valueScale } from './value-scale';

// a knob a chart is drawn from: its value, its travel (as the knob spreads its range: min, max, mode) and its routes
export interface LiveKnob {
  value: number;
  min: number;
  max: number;
  mode?: ScaleMode;
  modulations?: Route[];
}

// the range of a knob: a param def, a FilterRange
interface KnobRange {
  min: number;
  max: number;
  mode?: ScaleMode;
  disabled?: boolean;
}

// the knob of a chart at `value` in `range` with its routes; without a range or disabled (the filter type doesn't
// use it) it has no travel: its routes don't move it
export const liveKnob = (value: number, range?: KnobRange, modulations?: Route[]): LiveKnob =>
  range && !range.disabled
    ? { value, min: range.min, max: range.max, mode: range.mode, modulations }
    : { value, min: value, max: value };

const sameKnob = (a: LiveKnob, b: LiveKnob) =>
  a.value === b.value &&
  a.min === b.min &&
  a.max === b.max &&
  a.mode === b.mode &&
  a.modulations === b.modulations;

// the knobs of the last render while each knob is the same: a chart passes a new array every render
const useSameKnobs = (knobs: LiveKnob[]) => {
  const kept = React.useRef(knobs);
  const last = kept.current;
  if (last.length !== knobs.length || knobs.some((knob, i) => !sameKnob(knob, last[i]))) kept.current = knobs;
  return kept.current;
};

// ms between two drawings of a moving chart at least: every other frame of a 120 Hz screen (its marks every one)
export const MIN_FRAME_MS = 12;

// draws a chart of knobs, `draw` gets their values in their order (the array is reused: read it, don't keep it):
// at once, again when a knob or `draw` changes (the caller memoizes it), and while their routes sound in every frame
// they moved in, at the values the routes move them to (as the marks of the knobs: in steps of QUANTUM of their
// travel, at most every MIN_FRAME_MS), without a render; a sustain costs nothing. Inactive (the section is off, its
// sound isn't moved) it draws the values of the knobs
export const useLiveDraw = (knobs: LiveKnob[], draw: (values: number[]) => void, active = true) => {
  const same = useSameKnobs(knobs);
  React.useLayoutEffect(() => {
    const values = same.map(({ value }) => value);
    const routes = same.map(({ min, max, modulations }) =>
      active && min !== max && modulations ? liveRoutes(modulations) : []
    );
    if (routes.every((knob) => knob.length === 0)) {
      draw(values);
      return;
    }
    const scales = same.map(({ min, max, mode = 'linear' }) =>
      valueScale(mode).domain([min, max]).range([0, 1]).clamp(true)
    );
    const positions = same.map(({ value }, i) => scales[i](value));
    // the step of the travel each knob is at: drawn at its value exactly
    const steps = positions.map((position) => number.round(position, QUANTUM));
    // the shares drawn (null: the value of the knob, NaN: not drawn yet)
    const drawn: (number | null)[] = same.map(() => NaN);
    let drawnAt = -Infinity;
    const frame = () => {
      const now = performance.now();
      if (now - drawnAt < MIN_FRAME_MS) return;
      let moved = false;
      for (let i = 0; i < same.length; i++) {
        if (routes[i].length === 0) continue;
        const routed = routedShare(positions[i], routes[i]);
        const share = routed === steps[i] ? null : routed;
        if (share === drawn[i]) continue;
        drawn[i] = share;
        values[i] = share === null ? same[i].value : scales[i].invert(share);
        moved = true;
      }
      if (!moved) return;
      drawnAt = now;
      draw(values);
    };
    frame();
    return onFrame(frame);
  }, [same, draw, active]);
};
