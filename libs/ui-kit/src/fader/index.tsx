import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import hexToRgba from 'hex-to-rgba';
import { number } from '@waveform/math';
import { theme } from '../common/constants';
import { singlePointerTracker, valueScale } from '../common/utils';
import { Tooltip } from '../tooltip';
import { ValueTooltipContent } from '../tooltip/value-tooltip';
import { Label } from '../label';
import type { HandleProps } from '../handle';
import { AmountRing, AMOUNT_RING_SIZE } from '../amount-ring';
import { MOD_DRAGGING_CLASS, MOD_OVER_ATTR, MOD_TARGET_ATTR } from '../mod-drag';

// the props of a knob, fillFrom is e.g. the natural width of a stereo fader
type FaderProps = Omit<HandleProps, 'step' | 'size' | 'plotSize'> & { className?: string };

const WIDTH = 34;
const HEIGHT = 64;
const CAP_WIDTH = 26;
const CAP_HEIGHT = 12;
// px the cap moves from min to max
export const FADER_TRAVEL = HEIGHT - CAP_HEIGHT;
// scale marks every 10% of the travel, the longer ones at 0, 50 and 100%
const TICKS = Array.from({ length: 11 }, (_, i) => i / 10);
const isMajor = (i: number) => i % 5 === 0;
// quiet next to the cap and the fill: the minor marks are barely there, fillFrom stands out a little
const TICK_STYLES = {
  mark: { length: 7, color: theme.colors.primaryMediumContrast, opacity: 1 },
  major: { length: 5, color: theme.colors.primaryLowContrast, opacity: 1 },
  minor: { length: 3, color: theme.colors.primaryLowContrast, opacity: 0.55 },
};
// keyboard steps as parts of the travel
const KEY_STEPS: Record<string, number> = {
  ArrowUp: 0.01,
  ArrowRight: 0.01,
  ArrowDown: -0.01,
  ArrowLeft: -0.01,
  PageUp: 0.1,
  PageDown: -0.1,
};

const Root = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  touch-action: none;

  &.disabled {
    pointer-events: none;
    opacity: 0.5;
  }
`;

const Body = styled.div`
  position: relative;
  width: ${WIDTH}px;
  height: ${HEIGHT}px;
  cursor: ns-resize;

  &:focus {
    outline: none;
  }
`;

const Ticks = styled.svg`
  position: absolute;
  inset: 0;
  overflow: visible;
`;

// recessed into the panel, the same grey as the empty arc of a knob
const Slot = styled.div`
  position: absolute;
  left: 50%;
  top: ${CAP_HEIGHT / 2}px;
  bottom: ${CAP_HEIGHT / 2}px;
  width: 4px;
  margin-left: -2px;
  border-radius: 2px;
  background: ${theme.colors.primaryHighContrast};
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 45%);
`;

// lit like the arc of a knob
const Fill = styled.div`
  position: absolute;
  left: 50%;
  width: 4px;
  margin-left: -2px;
  border-radius: 2px;
  background: ${theme.colors.accent};
  box-shadow: 0 0 3px 1px ${hexToRgba(theme.colors.accent, 0.45)};
`;

// a light cap lit from above with a bevel like the tape switch keys, the dark line in the middle shows the value
const Cap = styled.div`
  position: absolute;
  left: 50%;
  width: ${CAP_WIDTH}px;
  height: ${CAP_HEIGHT}px;
  margin-left: ${-CAP_WIDTH / 2}px;
  border-radius: ${theme.borderRadius.s};
  background: ${theme.colors.primary}
    linear-gradient(180deg, rgb(255 255 255 / 70%), rgb(255 255 255 / 0%) 55%, rgb(0 0 0 / 6%));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 90%), inset 0 -2px 0 rgb(0 0 0 / 10%),
    0 3px 6px rgb(0 0 0 / 30%);

  /* the value line */
  &::before {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    top: ${CAP_HEIGHT / 2 - 1}px;
    height: 2px;
    border-radius: 1px;
    background: ${theme.colors.primaryDarkMediumContrast};
  }

  /* grip ridges above and below the line */
  &::after {
    content: '';
    position: absolute;
    left: 7px;
    right: 7px;
    top: 2px;
    height: 1px;
    background: rgb(0 0 0 / 10%);
    box-shadow: 0 7px 0 rgb(0 0 0 / 10%);
  }

  ${Body}:focus-visible & {
    outline: 1px solid ${theme.colors.secondAccent};
    outline-offset: 1px;
  }
`;

// a modulation: a bar of the color of its source beside the slot, from the value to the value + amount (a share
// of the travel); px from the middle of the slot to the first one, the width of a bar and the step to the next
const MOD_BAR_OFFSET = 4;
const MOD_BAR_WIDTH = 2;
const MOD_BAR_STEP = 3;

const ModBar = styled.div`
  position: absolute;
  width: ${MOD_BAR_WIDTH}px;
  border-radius: 1px;
`;

// lit while a source is dragged (mod-drag), brighter under the pointer
const ModHighlight = styled.div`
  position: absolute;
  inset: 0;
  border-radius: ${theme.borderRadius.m};
  pointer-events: none;
  display: none;

  body.${MOD_DRAGGING_CLASS} [${MOD_TARGET_ATTR}] > * > & {
    display: block;
    box-shadow: 0 0 0 2px var(--mod-drag-color);
  }

  body.${MOD_DRAGGING_CLASS} [${MOD_OVER_ATTR}] > * > & {
    box-shadow: 0 0 0 3px var(--mod-drag-color), 0 0 12px 3px var(--mod-drag-color);
  }
`;

// the amount rings, down the right side of the fader
const Ring = styled(AmountRing)`
  position: absolute;
  right: ${-AMOUNT_RING_SIZE - 2}px;
`;

// y of a position (0: min at the bottom, 1: max at the top) in the body, at the middle of the cap
const tickY = (position: number) => HEIGHT - CAP_HEIGHT / 2 - position * FADER_TRAVEL;

// a vertical fader like on a hardware synth, the value grows from the bottom up; drag the cap or the label,
// or press the track to jump there and drag on; arrows, page up/down, home and end when focused
export const Fader = ({
  min = 0,
  max = 100,
  value = 0,
  onChange,
  formatValue,
  label,
  mode = 'linear',
  precision = 1000,
  disabled = false,
  fillFrom,
  className,
  modulations = [],
  modTarget,
}: FaderProps) => {
  const scale = React.useMemo(
    () => valueScale(mode).domain([min, max]).range([0, 1]).clamp(true),
    [min, max, mode]
  );
  const toValue = React.useCallback(
    (position: number) =>
      // the scale clamps the position, rounding can still step out of the range
      number.thresholds(number.round(scale.invert(position), precision), min, max),
    [scale, precision, min, max]
  );
  const position = scale(value);
  const from = fillFrom === undefined ? 0 : scale(fillFrom);
  const [low, high] = [Math.min(from, position), Math.max(from, position)];

  const bodyRef = React.useRef<HTMLDivElement>(null);
  const capRef = React.useRef<HTMLDivElement>(null);
  const slotRef = React.useRef<HTMLDivElement>(null);
  const lastValue = React.useRef(value);
  const emit = (next: number) => {
    if (next === lastValue.current) return;
    lastValue.current = next;
    onChange?.(next);
  };

  const [trackPointer] = React.useState(singlePointerTracker);
  const onPointerDown = (e: React.PointerEvent) => {
    lastValue.current = value;
    const target = e.target as Node;
    // the track beside the cap: the cap jumps under the pointer, then follows it; the cap and the label
    // (like the label of a knob) drag relative to the value
    const onTrack = !!bodyRef.current?.contains(target) && !capRef.current?.contains(target);
    const rect = slotRef.current?.getBoundingClientRect();
    const start = onTrack && rect?.height ? (rect.bottom - e.clientY) / rect.height : position;
    const startY = e.clientY;
    const tracked = trackPointer(e, (move) => emit(toValue(start + (startY - move.clientY) / FADER_TRAVEL)));
    if (tracked && onTrack) emit(toValue(start));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number;
    if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (e.key in KEY_STEPS) {
      const step = KEY_STEPS[e.key];
      next = toValue(position + step);
      // a step smaller than the precision still moves by one unit
      if (next === value) next = number.thresholds(value + Math.sign(step) / precision, min, max);
    } else return;
    e.preventDefault();
    lastValue.current = value;
    emit(next);
  };

  const formatted = formatValue?.(value) ?? value;
  return (
    <Tooltip content={<ValueTooltipContent>{formatted}</ValueTooltipContent>}>
      <Root
        className={cls(className, { disabled })}
        onPointerDown={onPointerDown}
        {...(modTarget && !disabled && { [MOD_TARGET_ATTR]: modTarget })}
      >
        <Body
          ref={bodyRef}
          role='slider'
          tabIndex={disabled ? -1 : 0}
          aria-orientation='vertical'
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={typeof formatted === 'string' ? formatted : undefined}
          aria-label={typeof label === 'string' ? label : undefined}
          aria-disabled={disabled || undefined}
          onKeyDown={onKeyDown}
        >
          <Ticks width={WIDTH} height={HEIGHT} aria-hidden>
            {TICKS.map((tick, i) => {
              const marked = fillFrom !== undefined && Math.abs(tick - from) < 1e-9;
              const { length, color, opacity } =
                TICK_STYLES[marked ? 'mark' : isMajor(i) ? 'major' : 'minor'];
              const y = tickY(tick) + 0.5;
              return (
                <g
                  key={tick}
                  stroke={color}
                  strokeOpacity={opacity}
                  strokeWidth='1'
                  data-testid={marked ? 'fader-mark' : 'fader-tick'}
                >
                  <line x1={1} y1={y} x2={1 + length} y2={y} />
                  <line x1={WIDTH - 1 - length} y1={y} x2={WIDTH - 1} y2={y} />
                </g>
              );
            })}
          </Ticks>
          <Slot ref={slotRef} data-testid='fader-slot' />
          {high > low && (
            <Fill
              data-testid='fader-fill'
              style={{ bottom: CAP_HEIGHT / 2 + low * FADER_TRAVEL, height: (high - low) * FADER_TRAVEL }}
            />
          )}
          <Cap ref={capRef} data-testid='fader-cap' style={{ bottom: position * FADER_TRAVEL }} />
          {!disabled &&
            modulations.map(({ id, color, amount }, index) => {
              const end = number.thresholds(position + amount, 0, 1);
              return (
                <ModBar
                  key={id}
                  data-testid='mod-bar'
                  style={{
                    background: color,
                    left: WIDTH / 2 + MOD_BAR_OFFSET + index * MOD_BAR_STEP,
                    bottom: CAP_HEIGHT / 2 + Math.min(position, end) * FADER_TRAVEL,
                    height: Math.abs(end - position) * FADER_TRAVEL,
                  }}
                />
              );
            })}
          {!disabled &&
            modulations.map(({ id, label: source, onChange: onAmount, ...ring }, index) => (
              <Ring
                key={id}
                {...ring}
                label={source}
                onChange={onAmount}
                style={{ top: index * (AMOUNT_RING_SIZE + 2) }}
              />
            ))}
          <ModHighlight />
        </Body>
        {label && <Label>{label}</Label>}
      </Root>
    </Tooltip>
  );
};
