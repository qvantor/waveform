import React from 'react';
import styled from 'styled-components';
import { number, vector2d, Vector2D } from '@waveform/math';
import { text10 } from '../common/styles';
import { theme } from '../common/constants';
import { singlePointerTracker } from '../common/utils';
import { StepArrows } from './step-arrows';

interface Props {
  value: number;
  onChange?: (value: number) => void;
  label?: string;
  range?: Vector2D;
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

export const DraggableNumber = ({ value, onChange, label, range = [0, 10] }: Props) => {
  const [active, setActive] = React.useState(false);
  const [trackPointer] = React.useState(singlePointerTracker);
  const onPointerDown = (e: React.PointerEvent) => {
    const initial = vector2d.fromMouseEvent(e);
    const tracked = trackPointer(
      e,
      (e) => {
        const [, diffY] = vector2d.invertY(vector2d.subtract(vector2d.fromMouseEvent(e), initial));
        onChange?.(number.thresholds(value + Math.round(diffY / 10), ...range));
      },
      () => setActive(false)
    );
    if (tracked) setActive(true);
  };
  return (
    <Root onPointerDown={onPointerDown}>
      <Label>{label}</Label>
      <ValueContainer>
        <Value style={{ width: `${Math.max(...range.map((end) => String(end).length))}ch` }}>{value}</Value>
        <StepArrows active={active} />
      </ValueContainer>
    </Root>
  );
};
