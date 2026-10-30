import React from 'react';
import styled from 'styled-components';
import { arc } from 'd3-shape';
import cls from 'classnames';
import { number } from '@waveform/math';
import { theme } from '../common/constants';
import { singlePointerTracker } from '../common/utils';
import { OFF_OPACITY } from '../common/utils/mod-routes';
import { Tooltip } from '../tooltip';
import { ValueTooltipContent } from '../tooltip/value-tooltip';
import type { HandleModulation } from '../handle';

export interface AmountDotProps {
  // the colors of the sources of the routes on the control (envelopes): as many equal sections, clockwise from
  // the top
  colors: string[];
  // the routes switched off among them, in their order: their sections faded
  off?: boolean[];
  // the amount of the route it changes (of the selected source), -1..1: a share of the range of the control;
  // without it the dot only shows the routes, a press goes to the control under it
  amount?: number;
  onChange?: (amount: number) => void;
  // a press held still: the menu of the control (a route is removed there)
  onLongPress?: () => void;
  // the tooltip while it is held: the amount in the units of the knob (+2.4 oct, +35%; ±35% of a bipolar one)
  formatAmount?: (amount: number) => React.ReactNode;
  // the route moves the control around its value; Shift+click switches it (onPolarity)
  bipolar?: boolean;
  onPolarity?: (bipolar: boolean) => void;
  // the name of the source (the sources without an amount), for screen readers
  label?: string;
  className?: string;
  // its left and top are the point the dot is centered on
  style?: React.CSSProperties;
}

export const AMOUNT_DOT_SIZE = 14;
// the area a press takes, around the dot
const HIT_SIZE = 20;
// px of drag up from -100% to +100% (a row of the menu of the control too)
export const AMOUNT_TRAVEL = 200;
// ms a press held still takes to be a long press (the menu of the control), px it may move meanwhile
export const LONG_PRESS = 500;
export const STILL = 3;

const Root = styled.div`
  position: absolute;
  width: ${HIT_SIZE}px;
  height: ${HIT_SIZE}px;
  margin: ${-HIT_SIZE / 2}px 0 0 ${-HIT_SIZE / 2}px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: ns-resize;
  touch-action: none;

  /* a press goes to the control: its cursor */
  &.passive {
    cursor: inherit;
  }
`;

const Fill = styled.div`
  width: ${AMOUNT_DOT_SIZE}px;
  height: ${AMOUNT_DOT_SIZE}px;
  border-radius: 50%;
  display: flex;
`;

const RADIUS = AMOUNT_DOT_SIZE / 2;

// the sections of a dot of `count` sources: equal, clockwise from the top
const sectionPaths = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      arc()({
        innerRadius: 0,
        outerRadius: RADIUS,
        startAngle: (index / count) * 2 * Math.PI,
        endAngle: ((index + 1) / count) * 2 * Math.PI,
      }) ?? undefined
  );

// a section of the color of each source and over them a period of a sine, the sign of a modulation (9 px); dark:
// it reads on every color of a source
const Sections = ({ colors, off }: { colors: string[]; off?: boolean[] }) => {
  const paths = React.useMemo(() => sectionPaths(colors.length), [colors.length]);
  return (
    <svg
      width={AMOUNT_DOT_SIZE}
      height={AMOUNT_DOT_SIZE}
      viewBox={`${-RADIUS} ${-RADIUS} ${AMOUNT_DOT_SIZE} ${AMOUNT_DOT_SIZE}`}
      aria-hidden
    >
      {colors.map((color, index) => (
        <path
          key={index}
          d={paths[index]}
          fill={color}
          fillOpacity={off?.[index] ? OFF_OPACITY : undefined}
          data-testid='amount-dot-section'
        />
      ))}
      <path
        d='M1 5C2.5 1 3.5 1 5 5S7.5 9 9 5'
        transform='translate(-4.5 -4.5) scale(0.9)'
        fill='none'
        stroke={theme.colors.primaryDark}
        strokeWidth={1.5}
        strokeLinecap='round'
      />
    </svg>
  );
};

// the amount of a route in the units of the control (a percent without formatAmount), of a bipolar one around the
// value: ± its half on each side
export const amountText = (
  amount: number,
  bipolar: boolean,
  formatAmount?: (amount: number) => React.ReactNode
) => {
  const text = formatAmount ? formatAmount(amount) : number.percent(amount);
  return bipolar && typeof text === 'string' ? `±${text.replace(/^[+-]/, '')}` : text;
};

// an amount dragged: by 1%, within -100%..+100%
export const stepAmount = (amount: number) => number.thresholds(number.round(amount, 100), -1, 1);

// the dot with the route of the selected source: a slider of its amount
const AmountSlider = ({
  amount,
  onChange,
  onLongPress,
  formatAmount,
  bipolar = false,
  onPolarity,
  label,
  className,
  style,
  children,
}: Omit<AmountDotProps, 'colors' | 'amount'> & { amount: number; children: React.ReactNode }) => {
  const [trackPointer] = React.useState(singlePointerTracker);
  const last = React.useRef(amount);
  const emit = (next: number) => {
    const value = stepAmount(next);
    if (value === last.current) return;
    last.current = value;
    onChange?.(value);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // the knob under it doesn't turn
    e.stopPropagation();
    if (e.shiftKey && onPolarity) {
      onPolarity(!bipolar);
      return;
    }
    last.current = amount;
    const { clientX, clientY } = e;
    let still = true;
    const timer = window.setTimeout(() => {
      if (still) onLongPress?.();
    }, LONG_PRESS);
    const tracked = trackPointer(
      e,
      (move) => {
        if (Math.hypot(move.clientX - clientX, move.clientY - clientY) > STILL) still = false;
        if (!still) emit(amount + ((clientY - move.clientY) * 2) / AMOUNT_TRAVEL);
      },
      () => window.clearTimeout(timer)
    );
    if (!tracked) window.clearTimeout(timer);
  };

  return (
    <Tooltip content={<ValueTooltipContent>{amountText(amount, bipolar, formatAmount)}</ValueTooltipContent>}>
      <Root
        className={className}
        style={style}
        role='slider'
        aria-label={label}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(amount * 100)}
        data-testid='amount-dot'
        onPointerDown={onPointerDown}
        // it takes no focus, nor gives it to the control it is in: the keys stay those of the notes
        onMouseDown={(e) => e.preventDefault()}
      >
        {children}
      </Root>
    </Tooltip>
  );
};

// the routes on a control, next to it: a dot with a section of the color of each source and the sign of a
// modulation; with the amount of a route (of the selected source: the arc or the bar on the control shows it)
// dragged up or down it changes, a long press opens the menu of the control (a route is removed there)
export const AmountDot = ({ colors, off, amount, label, className, style, ...route }: AmountDotProps) => {
  const sections = (
    <Fill>
      <Sections colors={colors} off={off} />
    </Fill>
  );
  return amount === undefined ? (
    <Root
      className={cls(className, 'passive')}
      style={style}
      role='img'
      aria-label={label}
      data-testid='amount-dot'
    >
      {sections}
    </Root>
  ) : (
    <AmountSlider amount={amount} label={label} className={className} style={style} {...route}>
      {sections}
    </AmountSlider>
  );
};

// the dot of the routes on a control (a knob or a fader with routes): a section of each, in their order (one
// switched off faded); with a route of the selected source it changes that one, a long press on it opens the menu of
// the control (onLongPress; without a selected route the press goes to the control)
export const RoutesDot = ({
  modulations,
  onLongPress,
  className,
  style,
}: {
  modulations: HandleModulation[];
  onLongPress?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) => {
  const shown = modulations.find((route) => route.selected);
  return (
    <AmountDot
      key={shown?.id}
      colors={modulations.map(({ color }) => color)}
      off={modulations.map(({ off }) => !!off)}
      onLongPress={onLongPress}
      amount={shown?.amount}
      label={shown ? shown.label : modulations.map(({ id, label }) => label ?? id).join(', ')}
      onChange={shown?.onChange}
      formatAmount={shown?.formatAmount}
      bipolar={shown?.bipolar}
      onPolarity={shown?.onPolarity}
      className={className}
      style={style}
    />
  );
};
