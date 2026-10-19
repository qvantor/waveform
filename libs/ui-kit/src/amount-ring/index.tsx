import React from 'react';
import styled from 'styled-components';
import { arc } from 'd3-shape';
import { number } from '@waveform/math';
import { theme } from '../common/constants';
import { singlePointerTracker } from '../common/utils';
import { onFrame } from '../common/utils/frame-ticker';
import { Tooltip } from '../tooltip';
import { ValueTooltipContent } from '../tooltip/value-tooltip';

export interface AmountRingProps {
  // the color of the source (an envelope)
  color: string;
  // -1..1: a share of the range of the knob it modulates
  amount: number;
  onChange?: (amount: number) => void;
  // a double click or a long press
  onRemove?: () => void;
  // the tooltip while it is held: the amount in the units of the knob (+2.4 oct, +35%)
  formatAmount?: (amount: number) => React.ReactNode;
  // the name of the source, for screen readers
  label?: string;
  // the level of the source now (0..1, null: none): while live a dot follows it on the arc, drawn every frame
  // without a render
  level?: () => number | null;
  live?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const AMOUNT_RING_SIZE = 12;
// px of drag up from -100% to +100%
const TRAVEL = 200;
// ms a press held still takes to remove the route, px it may move meanwhile
const LONG_PRESS = 500;
const STILL = 3;
const KEY_STEP = 0.01;
const RADIUS = AMOUNT_RING_SIZE / 2;
// the live dot runs on the middle of the arc
const DOT_RADIUS = RADIUS - 1.25;
// ±100% is this angle either way from the top: the ends of the arc never meet
const FULL_ANGLE = (Math.PI * 17) / 18;

const Root = styled.div`
  width: ${AMOUNT_RING_SIZE}px;
  height: ${AMOUNT_RING_SIZE}px;
  border-radius: 50%;
  background: ${theme.colors.primaryDarkMediumContrast};
  cursor: ns-resize;
  touch-action: none;

  &:focus {
    outline: none;
  }

  &:focus-visible {
    outline: 1px solid ${theme.colors.secondAccent};
  }
`;

const ringArc = (endAngle: number) =>
  arc()({ innerRadius: RADIUS - 2.5, outerRadius: RADIUS, startAngle: 0, endAngle }) ?? undefined;

const background = ringArc(2 * Math.PI);

// the amount of a modulation route next to the knob it moves: its arc goes clockwise from the top for a positive
// amount, the other way for a negative one; dragged up or down it changes, a double click or a long press removes
// the route
export const AmountRing = ({
  color,
  amount,
  onChange,
  onRemove,
  formatAmount = (value) => number.percent(value),
  label,
  className,
  style,
  level,
  live = false,
}: AmountRingProps) => {
  const dot = React.useRef<SVGCircleElement>(null);
  React.useEffect(() => {
    const element = dot.current;
    if (!element || !live || !level) return;
    // the position drawn (a tenth of a pixel): the DOM is written only when it moves, a sustain costs nothing
    let drawn = '';
    const draw = () => {
      const value = level();
      let position = 'hidden';
      if (value !== null) {
        const angle = amount * value * FULL_ANGLE;
        position = `${(DOT_RADIUS * Math.sin(angle)).toFixed(1)} ${(-DOT_RADIUS * Math.cos(angle)).toFixed(
          1
        )}`;
      }
      if (position === drawn) return;
      if (value === null) element.style.visibility = 'hidden';
      else {
        const [x, y] = position.split(' ');
        element.setAttribute('cx', x);
        element.setAttribute('cy', y);
        if (drawn === '' || drawn === 'hidden') element.style.visibility = 'visible';
      }
      drawn = position;
    };
    draw();
    const stop = onFrame(draw);
    return () => {
      stop();
      element.style.visibility = 'hidden';
    };
  }, [live, level, amount]);

  const [trackPointer] = React.useState(singlePointerTracker);
  const last = React.useRef(amount);
  const emit = (next: number) => {
    const value = number.thresholds(number.round(next, 100), -1, 1);
    if (value === last.current) return;
    last.current = value;
    onChange?.(value);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // the knob under it doesn't turn
    e.stopPropagation();
    last.current = amount;
    const { clientX, clientY } = e;
    let still = true;
    const timer = window.setTimeout(() => {
      if (still) onRemove?.();
    }, LONG_PRESS);
    const tracked = trackPointer(
      e,
      (move) => {
        if (Math.hypot(move.clientX - clientX, move.clientY - clientY) > STILL) still = false;
        if (!still) emit(amount + ((clientY - move.clientY) * 2) / TRAVEL);
      },
      () => window.clearTimeout(timer)
    );
    if (!tracked) window.clearTimeout(timer);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') onRemove?.();
    else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') emit(amount + KEY_STEP);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') emit(amount - KEY_STEP);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const value = amount === 0 ? undefined : ringArc(amount * FULL_ANGLE);
  return (
    <Tooltip content={<ValueTooltipContent>{formatAmount(amount)}</ValueTooltipContent>}>
      <Root
        className={className}
        style={style}
        role='slider'
        tabIndex={0}
        aria-label={label}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(amount * 100)}
        data-testid='amount-ring'
        onPointerDown={onPointerDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onRemove?.();
        }}
        onKeyDown={onKeyDown}
      >
        <svg width={AMOUNT_RING_SIZE} height={AMOUNT_RING_SIZE} aria-hidden>
          <g transform={`translate(${RADIUS},${RADIUS})`}>
            <path d={background} fill={theme.colors.primaryHighContrast} />
            {value && <path d={value} fill={color} data-testid='amount-arc' />}
            <circle
              ref={dot}
              r={1.5}
              cx={0}
              cy={-DOT_RADIUS}
              fill={theme.colors.white}
              style={{ visibility: 'hidden' }}
              data-testid='amount-dot'
            />
          </g>
        </svg>
      </Root>
    </Tooltip>
  );
};
