import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { number } from '@waveform/math';
import { text10 } from '../common/styles';
import { theme } from '../common/constants';
import { useControlMenu } from '../control-menu';

interface Props {
  value: number;
  min: number;
  max: number;
  // without it the value is only shown (a tempo another device leads)
  onChange?: (value: number) => void;
  // after the value: BPM, EXT (led by another device)
  label: string;
  // the full name in the header of the menu
  name?: string;
  // the value of the menu's Default
  defaultValue?: number;
  className?: string;
}

// steps of the value
const PRECISION = 100;
// px of a drag a step of 1 (Shift: of 0.01 every px)
const PX_PER_STEP = 4;
const PAGE_STEP = 10;

// a screen in its cell of the panel: ◀ the value and its label ▶
const Root = styled.div`
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: ${theme.colors.primary};
`;

const Screen = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: ${theme.colors.primaryDark};
  color: ${theme.colors.white};
  white-space: nowrap;
  user-select: none;
  transition: color 150ms;

  &.editable {
    cursor: ns-resize;
    touch-action: none;
    -webkit-touch-callout: none;
  }

  &.active {
    color: ${theme.colors.accent};
  }

  &:focus,
  &:focus-visible {
    outline: none;
  }
`;

// digits of one width, as wide as the widest value: it doesn't widen while dragged
const Value = styled.span`
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

const Label = styled.span`
  ${text10};
  font-weight: 600;
  letter-spacing: 1px;
  color: ${theme.colors.primaryDarkHighContrast};
`;

const Input = styled.input`
  width: 7ch;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: right;

  &:focus {
    outline: none;
  }
`;

const Arrow = styled.button`
  flex: none;
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 3px;
  border: none;
  border-radius: 3px;
  background: ${theme.colors.primaryDark};
  color: ${theme.colors.white};
  font-size: 10px;
  cursor: pointer;
  transition: background 150ms;

  &:hover {
    background: ${theme.colors.primaryDarkHighContrast};
  }

  &:active {
    background: ${theme.colors.primaryDarkMediumContrast};
  }
`;

// a value with up to 2 decimals: 120, 128.5, 93.75
export const formatTempo = (value: number) => `${number.round(value, PRECISION)}`;

// the tempo of the synth: dragged up or right (1 a step every 4 px, Shift 0.01 every px), ◀ ▶ and the arrow keys
// step by 1 (Shift 0.01), page up/down by 10; a double click types it (Enter or a click elsewhere takes it,
// Escape doesn't); its menu (a right click, a long press) sets the default. Without onChange only shown
export const TempoField = ({
  value,
  min,
  max,
  onChange,
  label,
  name = 'Tempo',
  defaultValue,
  className,
}: Props) => {
  const [active, setActive] = React.useState(false);
  const [typing, setTyping] = React.useState<string | null>(null);
  const lastValue = React.useRef(value);
  const editable = !!onChange;
  const toValue = (raw: number) => number.thresholds(number.round(raw, PRECISION), min, max);
  const emit = (next: number) => {
    if (next === lastValue.current) return;
    lastValue.current = next;
    onChange?.(next);
  };
  const step = (by: number) => {
    lastValue.current = value;
    emit(toValue(value + by));
  };

  const menu = useControlMenu({
    name,
    value,
    formatValue: formatTempo,
    defaultValue,
    min,
    max,
    onChange,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (typing !== null) return;
    lastValue.current = value;
    const [startX, startY] = [e.clientX, e.clientY];
    const tracked = menu.track(
      e,
      (move) => {
        const diff = move.clientX - startX - (move.clientY - startY);
        emit(toValue(move.shiftKey ? value + diff / PRECISION : value + Math.round(diff / PX_PER_STEP)));
      },
      () => setActive(false)
    );
    if (tracked) setActive(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const unit = e.shiftKey ? 1 / PRECISION : 1;
    const steps: Record<string, number> = {
      ArrowUp: unit,
      ArrowRight: unit,
      ArrowDown: -unit,
      ArrowLeft: -unit,
      PageUp: PAGE_STEP,
      PageDown: -PAGE_STEP,
    };
    if (!(e.key in steps)) return;
    e.preventDefault();
    step(steps[e.key]);
  };

  const commit = () => {
    if (typing === null) return;
    const typed = Number.parseFloat(typing.replace(',', '.'));
    setTyping(null);
    if (Number.isFinite(typed)) {
      lastValue.current = value;
      emit(toValue(typed));
    }
  };

  const formatted = formatTempo(value);
  const width = `${Math.max(formatTempo(min).length, formatTempo(max).length) + 3}ch`;
  return (
    <Root className={className}>
      {editable && (
        <Arrow type='button' aria-label='Slower' tabIndex={-1} onClick={() => step(-1)}>
          <LeftOutlined />
        </Arrow>
      )}
      <Screen
        ref={menu.anchorRef}
        className={cls({ editable, active })}
        onContextMenu={menu.onContextMenu}
        {...(editable && {
          role: 'slider',
          tabIndex: 0,
          'aria-label': name,
          'aria-valuemin': min,
          'aria-valuemax': max,
          'aria-valuenow': value,
          'aria-valuetext': `${formatted} ${label}`,
          onPointerDown,
          onKeyDown,
          onDoubleClick: () => setTyping(formatted),
        })}
      >
        {typing !== null ? (
          <Input
            aria-label={name}
            inputMode='decimal'
            autoFocus
            value={typing}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTyping(e.currentTarget.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setTyping(null);
            }}
          />
        ) : (
          <Value style={{ width }}>{formatted}</Value>
        )}
        <Label>{label}</Label>
      </Screen>
      {editable && (
        <Arrow type='button' aria-label='Faster' tabIndex={-1} onClick={() => step(1)}>
          <RightOutlined />
        </Arrow>
      )}
      {menu.menu}
    </Root>
  );
};
