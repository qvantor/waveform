import React from 'react';
import cls from 'classnames';
import { CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import styled from 'styled-components';
import { number, vector2d, Vector2D } from '@waveform/math';
import { text10 } from '../common/styles';
import { theme } from '../common/constants';

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

const Value = styled.div`
  width: 12px;
  text-align: right;
`;

const Controls = styled.div`
  display: flex;
  flex-direction: column;
  margin: -5px 0;
  transition: all 150ms;

  &.active {
    color: ${theme.colors.accent};
  }

  .up {
    margin-bottom: -2px;
  }

  .down {
    margin-top: -2px;
  }
`;

export const DraggableNumber = ({ value, onChange, label, range = [0, 10] }: Props) => {
  const [active, setActive] = React.useState(false);
  const onMouseDown = (e: React.MouseEvent) => {
    const initial = vector2d.fromMouseEvent(e);
    const mouseMove = (e: MouseEvent) => {
      const [, diffY] = vector2d.invertY(vector2d.subtract(vector2d.fromMouseEvent(e), initial));
      onChange?.(number.thresholds(value + Math.round(diffY / 10), ...range));
    };

    const cleanUp = () => {
      setActive(false);
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', cleanUp);
    };

    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', cleanUp);
    setActive(true);
  };
  return (
    <Root onMouseDown={onMouseDown}>
      <Label>{label}</Label>
      <ValueContainer>
        <Value>{value}</Value>
        <Controls className={cls({ active: active })}>
          <CaretUpOutlined className='up' />
          <CaretDownOutlined className='down' />
        </Controls>
      </ValueContainer>
    </Root>
  );
};
