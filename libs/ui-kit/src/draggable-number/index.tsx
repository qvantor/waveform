import React from 'react';
import styled from 'styled-components';
import { number, vector2d, Vector2D } from '@waveform/math';
import { text10 } from '../common/styles';
import { theme } from '../common/constants';
import { useControlMenu } from '../control-menu';
import { StepArrows } from './step-arrows';

interface Props {
  value: number;
  onChange?: (value: number) => void;
  label?: string;
  range?: Vector2D;
  // the value of an empty preset: the menu (a right click, a long press on a touch screen) sets it
  defaultValue?: number;
  // the full name of what it sets, in the header of the menu; the label by default
  name?: string;
}

const Root = styled.div`
  font-size: 12px;
  line-height: 12px;
  display: inline-flex;
  align-items: end;
  justify-content: space-between;
  gap: 8px;
  background: ${theme.colors.primaryDark};
  color: ${theme.colors.white};
  border-radius: 3px;
  padding: 5px 6px;
  cursor: ns-resize;
  touch-action: none;
  -webkit-touch-callout: none;
`;

const Label = styled.div`
  ${text10};
  font-weight: 600;
`;

const ValueContainer = styled.div`
  display: flex;
  gap: 3px;
  align-items: center;
`;

// as wide as the widest value of its range (style), digits of one width: it doesn't widen while dragged
const Value = styled.div`
  min-width: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
`;

// a whole number dragged up or down, a step every 10 px; its menu (a right click, a long press) sets the default
export const DraggableNumber = ({
  value,
  onChange,
  label,
  range = [0, 10],
  defaultValue,
  name = label,
}: Props) => {
  const [active, setActive] = React.useState(false);
  const menu = useControlMenu({ name, value, defaultValue, min: range[0], max: range[1], onChange });
  const onPointerDown = (e: React.PointerEvent) => {
    const initial = vector2d.fromMouseEvent(e);
    let last = value;
    const tracked = menu.track(
      e,
      (e) => {
        const [, diffY] = vector2d.invertY(vector2d.subtract(vector2d.fromMouseEvent(e), initial));
        const next = number.thresholds(value + Math.round(diffY / 10), ...range);
        if (next === last) return;
        last = next;
        onChange?.(next);
      },
      () => setActive(false)
    );
    if (tracked) setActive(true);
  };
  return (
    <Root ref={menu.anchorRef} onPointerDown={onPointerDown} onContextMenu={menu.onContextMenu}>
      <Label>{label}</Label>
      <ValueContainer>
        <Value style={{ width: `${Math.max(...range.map((end) => String(end).length))}ch` }}>{value}</Value>
        <StepArrows active={active} />
      </ValueContainer>
      {menu.menu}
    </Root>
  );
};
