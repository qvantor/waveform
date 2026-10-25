import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { number } from '@waveform/math';
import { theme } from '../common/constants';
import { Tooltip } from '../tooltip';
import { ValueTooltip } from '../tooltip/value-tooltip';

const WIDTH = 26;
const CAP_HEIGHT = 12;
// the steps of the value (a 14-bit wheel has 16384)
const PRECISION = 1000;

const Body = styled.div`
  position: relative;
  flex: none;
  width: ${WIDTH}px;
  border-radius: ${theme.borderRadius.m};
  background: ${theme.colors.primaryDark};
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 60%);
  cursor: ns-resize;
  touch-action: none;
`;

// the rest position: a line across the slot
const Center = styled.div`
  position: absolute;
  left: 3px;
  right: 3px;
  top: 50%;
  height: 1px;
  background: ${theme.colors.primaryHighContrast};
`;

// a light cap like the one of the fader, the line in its middle shows the bend; lit while it is held
const Cap = styled.div`
  position: absolute;
  left: 3px;
  right: 3px;
  height: ${CAP_HEIGHT}px;
  margin-top: ${-CAP_HEIGHT / 2}px;
  border-radius: ${theme.borderRadius.s};
  background: ${theme.colors.primary}
    linear-gradient(180deg, rgb(255 255 255 / 70%), rgb(255 255 255 / 0%) 55%, rgb(0 0 0 / 6%));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 90%), inset 0 -2px 0 rgb(0 0 0 / 10%),
    0 2px 4px rgb(0 0 0 / 40%);

  &::before {
    content: '';
    position: absolute;
    left: 3px;
    right: 3px;
    top: ${CAP_HEIGHT / 2 - 1}px;
    height: 2px;
    border-radius: 1px;
    background: ${theme.colors.primaryDarkMediumContrast};
  }

  &.active::before {
    background: ${theme.colors.accent};
  }
`;

interface Props {
  // -1 all the way down .. 1 all the way up, 0 at rest
  value: number;
  onChange?: (value: number) => void;
  // the full name before the value in the tooltip while it is held, its accessible name
  name?: string;
  formatValue?: (value: number) => React.ReactNode;
  // px of its body
  height?: number;
  className?: string;
}

// a pitch bend wheel as on a hardware keyboard: dragged up or down from where it is (the full travel is half its
// height), it springs back to the middle once let go, also when the window loses focus or its pointerup was lost
// (a move without a button). It shows the value it is given (a bend of a MIDI input too)
export const PitchWheel = ({
  value,
  onChange,
  name = 'Pitch bend',
  formatValue,
  height = 64,
  className,
}: Props) => {
  const [active, setActive] = React.useState(false);
  // the pointer that holds it, where it pressed and the value then
  const drag = React.useRef<{ pointerId: number; y: number; from: number } | null>(null);
  const callbacks = React.useRef({ onChange, value });
  callbacks.current = { onChange, value };
  const travel = (height - CAP_HEIGHT) / 2;

  const emit = React.useCallback((next: number) => {
    if (next === callbacks.current.value) return;
    callbacks.current.value = next;
    callbacks.current.onChange?.(next);
  }, []);

  const release = React.useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setActive(false);
    emit(0);
  }, [emit]);

  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const held = drag.current;
      if (!held || e.pointerId !== held.pointerId) return;
      if (e.buttons === 0) {
        release();
        return;
      }
      const share = held.from + (held.y - e.clientY) / travel;
      emit(number.round(number.thresholds(share, -1, 1), PRECISION));
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === drag.current?.pointerId) release();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', release);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', release);
    };
  }, [travel, emit, release]);

  // unmounted while it is held: back at rest
  React.useEffect(() => release, [release]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (drag.current || e.button !== 0) return;
    // a finger is captured by the element it pressed: its moves are followed on the document
    if (e.target instanceof Element && e.target.hasPointerCapture(e.pointerId))
      e.target.releasePointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, y: e.clientY, from: value };
    setActive(true);
  };

  const formatted = formatValue?.(value) ?? value;
  return (
    // above it: the wheel is at the bottom of the screen
    <Tooltip bottom={height + 6} content={<ValueTooltip name={name}>{formatted}</ValueTooltip>}>
      <Body
        className={className}
        style={{ height }}
        onPointerDown={onPointerDown}
        role='slider'
        aria-orientation='vertical'
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={value}
        aria-valuetext={typeof formatted === 'string' ? formatted : undefined}
        aria-label={name}
      >
        <Center />
        <Cap
          className={cls({ active })}
          data-testid='pitch-wheel-cap'
          style={{ top: `${height / 2 - value * travel}px` }}
        />
      </Body>
    </Tooltip>
  );
};
