import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import hexToRgba from 'hex-to-rgba';
import { number } from '@waveform/math';
import { text12 } from '../common/styles';
import { theme } from '../common/constants';
import { singlePointerTracker } from '../common/utils';
import { StepArrows } from '../draggable-number/step-arrows';

interface DragValueProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  // steps per unit
  precision?: number;
  // px of drag from min to max, as much as a knob
  travel?: number;
  // past one end it goes on from the other (an angle): max is min
  cyclic?: boolean;
  // it steps by whole numbers: the arrows of DraggableNumber after the value
  arrows?: boolean;
  formatValue?: (value: number) => string;
  // without it the value is only shown
  onChange?: (value: number) => void;
  // a pointer holds it (true) or let it go (false)
  onActiveChange?: (active: boolean) => void;
  className?: string;
}

// keyboard steps as parts of the range
const PAGE_STEP = 0.1;

const Root = styled.div`
  ${text12};
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 3px 7px;
  border-radius: 3px;
  color: ${theme.colors.white};
  white-space: nowrap;
  user-select: none;
  transition: background 150ms;

  &.editable {
    cursor: move;
    touch-action: none;

    &:hover,
    &.active {
      background: ${hexToRgba(theme.colors.primaryDarkMediumContrast, 0.6)};
    }
  }

  &:focus,
  &:focus-visible {
    outline: none;
  }
`;

const Label = styled.span`
  font-weight: 600;
  color: ${theme.colors.primaryDarkHighContrast};
`;

const Value = styled.span`
  font-variant-numeric: tabular-nums;
  transition: color 150ms;

  .active > & {
    color: ${theme.colors.accent};
  }
`;

// a value shown as text, pressed and dragged to change it: right or up raises it, left or down lowers it
// (both add up); arrows and page up/down when focused
export const DragValue = ({
  label,
  value,
  min = 0,
  max = 1,
  precision = 100,
  travel = 200,
  cyclic = false,
  arrows = false,
  formatValue,
  onChange,
  onActiveChange,
  className,
}: DragValueProps) => {
  const [active, setActive] = React.useState(false);
  const [trackPointer] = React.useState(singlePointerTracker);
  const lastValue = React.useRef(value);
  const toValue = (raw: number) => {
    if (!cyclic) return number.thresholds(number.round(raw, precision), min, max);
    const range = max - min;
    const wrapped = min + number.round(raw - min - Math.floor((raw - min) / range) * range, precision);
    return wrapped >= max ? min : wrapped;
  };
  const emit = (next: number) => {
    if (next === lastValue.current) return;
    lastValue.current = next;
    onChange?.(next);
  };

  const hold = (held: boolean) => {
    setActive(held);
    onActiveChange?.(held);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    lastValue.current = value;
    const [startX, startY] = [e.clientX, e.clientY];
    const tracked = trackPointer(
      e,
      (move) => {
        const diff = move.clientX - startX - (move.clientY - startY);
        emit(toValue(value + (diff / travel) * (max - min)));
      },
      () => hold(false)
    );
    if (tracked) hold(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowUp: 1 / precision,
      ArrowRight: 1 / precision,
      ArrowDown: -1 / precision,
      ArrowLeft: -1 / precision,
      PageUp: PAGE_STEP * (max - min),
      PageDown: -PAGE_STEP * (max - min),
    };
    if (!(e.key in steps)) return;
    e.preventDefault();
    lastValue.current = value;
    emit(toValue(value + steps[e.key]));
  };

  const formatted = formatValue?.(value) ?? `${value}`;
  const editable = !!onChange;
  return (
    <Root
      className={cls(className, { editable, active })}
      {...(editable && {
        role: 'slider',
        tabIndex: 0,
        'aria-label': label,
        'aria-valuemin': min,
        'aria-valuemax': max,
        'aria-valuenow': value,
        'aria-valuetext': formatted,
        onPointerDown,
        onKeyDown,
      })}
    >
      <Label>{label}</Label>
      <Value>{formatted}</Value>
      {arrows && <StepArrows active={active} />}
    </Root>
  );
};
