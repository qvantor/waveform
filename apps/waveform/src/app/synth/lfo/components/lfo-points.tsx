import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import {
  CurvePoint,
  POINT_HIT_RADIUS,
  POINT_RADIUS,
  singlePointerTracker,
  theme,
  useLineChartContext,
} from '@waveform/ui-kit';
import { ENVELOPE_CURVE_MAX, LFO_POINTS_MAX, LfoPoint } from '@waveform/preset-schema';
import { segmentEnd } from '../../common/lfo/lfo-curve';
import { insertPoint, movePoint, nearestSpot, removePoint, setCurve } from '../lfo-edit';

// px from the line a press adds a point within (the spot shown while the pointer is there)
const ADD_RADIUS = 6;
// px of a segment at least that has a point of its curve: narrower ones crowd it
const HANDLE_MIN_WIDTH = 12;

// the plot: a press near the line adds a point there
const Area = styled.rect`
  fill: transparent;
  touch-action: none;

  &.near {
    cursor: copy;
  }
`;

// a point is filled (the point of a curve is hollow), white while held or hovered
const Dot = styled.g`
  cursor: move;
  touch-action: none;
  outline: none;

  .dot {
    fill: ${theme.colors.accent};
    transition: fill 150ms;
  }

  &:hover .dot,
  &.active .dot {
    fill: ${theme.colors.white};
  }
`;

// where a press adds a point: a translucent one
const Ghost = styled.circle`
  fill: ${theme.colors.accent};
  fill-opacity: 0.5;
  pointer-events: none;
`;

interface Props {
  points: readonly LfoPoint[];
  // the line of the points: [share of the cycle, level] from 0 to 1
  line: readonly (readonly [number, number])[];
  onChange: (points: LfoPoint[]) => void;
}

// the points of the shape of an LFO on its chart: each dragged within its neighbours (onto one: a step; the first
// stays at the start of the cycle), a double click takes it out (two stay, the first too); between two the point
// of the curve of their segment, as the envelopes have it (the last segment to the start of the cycle too); a
// press within ADD_RADIUS of the line adds a point there (shown before, translucent) and drags it on. No keys: a point
// is a place, not a value
export const LfoPoints = ({ points, line, onChange }: Props) => {
  const { scaleX, scaleY } = useLineChartContext();
  const [trackPointer] = React.useState(singlePointerTracker);
  const [active, setActive] = React.useState<number | null>(null);
  const [ghost, setGhost] = React.useState<[number, number] | null>(null);
  const pixels = React.useMemo(
    () => line.map(([x, y]): [number, number] => [scaleX(x), scaleY(y)]),
    [line, scaleX, scaleY]
  );

  const emit = (next: LfoPoint[] | null) => {
    if (next) onChange(next);
  };

  // point i of `base` follows the pointer from where it was pressed
  const startDrag = (e: React.PointerEvent, base: readonly LfoPoint[], i: number) => {
    const [x0, y0] = base[i];
    const [startX, startY] = [e.clientX, e.clientY];
    let last = base;
    const tracked = trackPointer(
      e,
      (move) => {
        const next = movePoint(
          last,
          i,
          scaleX.invert(scaleX(x0) + move.clientX - startX),
          scaleY.invert(scaleY(y0) + move.clientY - startY)
        );
        if (!next) return;
        last = next;
        onChange(next);
      },
      () => setActive(null)
    );
    if (!tracked) return;
    setActive(i);
    setGhost(null);
  };

  // the spot of the line a press at the pointer adds a point at: none while a point is dragged, near one or at
  // LFO_POINTS_MAX
  const spotAt = (e: React.PointerEvent<SVGRectElement>) => {
    if (active !== null || points.length >= LFO_POINTS_MAX) return null;
    const box = e.currentTarget.getBoundingClientRect();
    const spot = nearestSpot(pixels, e.clientX - box.left, e.clientY - box.top, ADD_RADIUS);
    if (!spot) return null;
    // none within the hit area of a point: it takes the press anyway
    const near = points.some(
      ([x, y]) => Math.hypot(scaleX(x) - spot[0], scaleY(y) - spot[1]) < POINT_HIT_RADIUS
    );
    return near ? null : spot;
  };

  const onAreaMove = (e: React.PointerEvent<SVGRectElement>) => {
    const spot = spotAt(e);
    if (spot?.[0] !== ghost?.[0] || spot?.[1] !== ghost?.[1]) setGhost(spot);
  };

  const onAreaDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    // the spot at the press itself: a touch hovers nothing
    const spot = spotAt(e);
    if (!spot) return;
    const next = insertPoint(points, scaleX.invert(spot[0]));
    if (!next) return;
    onChange(next.points);
    startDrag(e, next.points, next.index);
  };

  return (
    <>
      <Area
        data-testid='lfo-area'
        className={cls({ near: ghost !== null })}
        width={scaleX.range()[1]}
        height={scaleY.range()[1]}
        onPointerMove={onAreaMove}
        onPointerLeave={() => setGhost(null)}
        onPointerDown={onAreaDown}
      />
      {points.map(([x0, y0, k], j) => {
        const [x1, y1] = segmentEnd(points, j);
        if (y0 === y1 || scaleX(x1) - scaleX(x0) < HANDLE_MIN_WIDTH) return null;
        return (
          <CurvePoint
            key={j}
            label={`Segment ${j + 1} curve`}
            from={[x0, y0]}
            to={[x1, y1]}
            k={k}
            max={ENVELOPE_CURVE_MAX}
            fallback={0}
            onChange={(next) => emit(setCurve(points, j, next))}
          />
        );
      })}
      {points.map(([x, y], i) => (
        <Dot
          key={i}
          className={cls({ active: active === i })}
          transform={`translate(${scaleX(x)}, ${scaleY(y)})`}
          role='button'
          aria-label={`Point ${i + 1}`}
          onPointerDown={(e) => startDrag(e, points, i)}
          onDoubleClick={() => emit(removePoint(points, i))}
        >
          <circle r={POINT_HIT_RADIUS} fill='transparent' />
          <circle className='dot' r={POINT_RADIUS} />
        </Dot>
      ))}
      {ghost && <Ghost data-testid='lfo-ghost' r={POINT_RADIUS} cx={ghost[0]} cy={ghost[1]} />}
    </>
  );
};
