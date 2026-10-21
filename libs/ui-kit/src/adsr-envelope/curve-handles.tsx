import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { number } from '@waveform/math';
import { useLineChartContext } from '../line-chart';
import { theme } from '../common/constants';
import { singlePointerTracker } from '../common/utils';
import { AdsrCurves, curveShape, envelopeLine, LINEAR_CURVES, LineProps } from './envelope-line';

export type CurveStage = keyof AdsrCurves;

// seconds of a stage at most that has no point: its curve barely shows, its corners crowd it
export const CURVE_HANDLE_MIN_TIME = 0.02;
// px from the middle of the line a point snaps to it (k 0: a line can't be hit by a drag otherwise)
const SNAP = 3;
const RADIUS = 3.5;
// the area a press takes, around the point
const HIT_RADIUS = 10;
// k a key press moves the point by, k in steps of 0.01
const KEY_STEP = 0.1;
const KEY_DIRECTIONS: Record<string, number> = { ArrowUp: 1, ArrowDown: -1 };
const PRECISION = 100;
// the shares of a stage at its middle a drag goes to at most (a line of 0 or 1 has no k)
const SHARE_EDGE = 1e-6;

// the share of a stage done at its middle is curveShape(k, 0.5) = 1 / (1 + e^(-k/2)): the k of a share there
export const curveFromMidShare = (share: number) => 2 * Math.log(share / (1 - share));

// the stages a point curves, by the index of their first corner of envelopeLine
const STAGES: [CurveStage, number, string][] = [
  ['attack', 0, 'Attack curve'],
  ['decay', 2, 'Decay curve'],
  ['release', 3, 'Release curve'],
];

const Point = styled.g`
  cursor: ns-resize;
  touch-action: none;
  outline: none;

  .dot {
    fill: ${theme.colors.primaryDark};
    stroke: ${theme.colors.accent};
    stroke-width: 1.5;
    transition: fill 150ms;
  }

  &:hover .dot,
  &.active .dot,
  &:focus-visible .dot {
    fill: ${theme.colors.accent};
  }
`;

interface PointProps {
  stage: CurveStage;
  label: string;
  // the corners of the stage: [seconds, level]
  from: [number, number];
  to: [number, number];
  k: number;
  max: number;
  // the k of a double click
  fallback: number;
  onChange: (stage: CurveStage, k: number) => void;
}

// the point of a curved stage, in its middle on its curve: dragged up or down it follows the pointer (the share
// of the stage done there gives the k), arrows move it too, a double click sets the default
const CurvePoint = ({
  stage,
  label,
  from: [x0, y0],
  to: [x1, y1],
  k,
  max,
  fallback,
  onChange,
}: PointProps) => {
  const { scaleX, scaleY } = useLineChartContext();
  const [active, setActive] = React.useState(false);
  const [trackPointer] = React.useState(singlePointerTracker);
  const last = React.useRef(k);
  // px from the start level to the end level of the stage (y down: < 0 for a rising stage)
  const span = scaleY(y1) - scaleY(y0);
  const share = curveShape(k, 0.5);
  const min = -max;

  const emit = (next: number) => {
    const value = number.thresholds(number.round(next, PRECISION), min, max);
    if (value === last.current) return;
    last.current = value;
    onChange(stage, value);
  };
  // a change from the k it has now (a key, a double click)
  const emitFromNow = (next: number) => {
    last.current = k;
    emit(next);
  };
  const toShare = (next: number) => {
    if (Math.abs((next - 0.5) * span) < SNAP) emit(0);
    else emit(curveFromMidShare(number.thresholds(next, SHARE_EDGE, 1 - SHARE_EDGE)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    last.current = k;
    const startY = e.clientY;
    const tracked = trackPointer(
      e,
      (move) => toShare(share + (move.clientY - startY) / span),
      () => setActive(false)
    );
    if (tracked) setActive(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const direction = KEY_DIRECTIONS[e.key];
    if (!direction) return;
    e.preventDefault();
    // up raises the point: more k on a rising stage, less on a falling one
    emitFromNow(k + direction * Math.sign(y1 - y0) * KEY_STEP);
  };

  return (
    <Point
      className={cls({ active })}
      transform={`translate(${scaleX((x0 + x1) / 2)}, ${scaleY(y0 + (y1 - y0) * share)})`}
      role='slider'
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={k}
      onPointerDown={onPointerDown}
      onDoubleClick={() => emitFromNow(fallback)}
      onKeyDown={onKeyDown}
    >
      <circle r={HIT_RADIUS} fill='transparent' />
      <circle className='dot' r={RADIUS} />
    </Point>
  );
};

type Props = LineProps & {
  curves?: AdsrCurves;
  // |k| at most
  max?: number;
  // the curves of a double click (lines without them)
  defaults?: AdsrCurves;
  onChange: (stage: CurveStage, k: number) => void;
};

// the points that curve the stages of an envelope on its chart: one in the middle of each stage longer than
// CURVE_HANDLE_MIN_TIME that moves the level (a decay to a sustain of 1 or a release from 0 is flat: its curve
// doesn't show)
export const CurveHandles = ({
  curves = LINEAR_CURVES,
  max = Infinity,
  defaults,
  onChange,
  ...stages
}: Props) => {
  const { corners } = envelopeLine(stages);
  return (
    <>
      {STAGES.map(([stage, corner, label]) => {
        const from = corners[corner];
        const to = corners[corner + 1];
        if (stages[stage] <= CURVE_HANDLE_MIN_TIME || from[1] === to[1]) return null;
        return (
          <CurvePoint
            key={stage}
            stage={stage}
            label={label}
            from={from}
            to={to}
            k={curves[stage]}
            max={max}
            fallback={defaults?.[stage] ?? 0}
            onChange={onChange}
          />
        );
      })}
    </>
  );
};
