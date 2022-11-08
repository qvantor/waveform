import React from 'react';
import styled from 'styled-components';
import { arc } from 'd3-shape';
import cls from 'classnames';
import { Vector2D, vector2d, number } from '@waveform/math';
import { scaleLinear, scaleLog } from 'd3-scale';
import { theme } from '../common/constants';
import { absoluteCenterXY } from '../common/styles';
import { Tooltip } from '../tooltip';
import { Label } from '../label';

type Size = 'm' | 'l';

type Mode = 'linear' | 'log';

export interface HandleProps {
  min?: number;
  max?: number;
  value?: number;
  step?: number[];
  size?: Size;
  onChange?: (value: number) => void;
  formatValue?: (value: number) => React.ReactNode;
  label?: React.ReactNode;
  mode?: Mode;
  precision?: number;
  plotSize?: number;
  disabled?: boolean;
}

interface StyledProps {
  size: Size;
}

const sizes: Record<
  Size,
  Record<'wrapper' | 'handleOuter' | 'handleInner' | 'mark', [string, string]> & {
    arc: [number, number];
    svg: [number, number];
  }
> = {
  m: {
    wrapper: ['50px', '50px'],
    handleOuter: ['34px', '34px'],
    handleInner: ['32px', '32px'],
    mark: ['2px', '2px'],
    svg: [30, 30],
    arc: [19, 21],
  },
  l: {
    wrapper: ['60px', '60px'],
    handleOuter: ['44px', '44px'],
    handleInner: ['42px', '42px'],
    mark: ['3px', '3px'],
    svg: [40, 40],
    arc: [29, 31],
  },
};

const Root = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  &.disabled {
    pointer-events: none;
    opacity: 0.5;
  }
`;

const HandleContainer = styled.div<StyledProps>`
  width: ${(props) => `${sizes[props.size].wrapper[0]}`};
  height: ${(props) => `${sizes[props.size].wrapper[1]}`};
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  user-select: none;
`;

const HandleCircle = styled.div<StyledProps>`
  width: ${(props) => `${sizes[props.size].handleOuter[0]}`};
  height: ${(props) => `${sizes[props.size].handleOuter[1]}`};
  margin: auto;
  border-radius: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  background: ${theme.colors.primaryMediumContrast};
  z-index: 2;
`;

const HandleCircleShadow = styled.div<StyledProps>`
  position: absolute;
  ${absoluteCenterXY};
  width: ${(props) => `${sizes[props.size].handleOuter[0]}`};
  height: ${(props) => `${sizes[props.size].handleOuter[1]}`};
  border-radius: 100%;
  box-shadow: 4px 8px 28px 0 rgba(0, 0, 0, 0.35);
  z-index: 2;
`;

const HandleCircleInner = styled.div<StyledProps>`
  background: ${theme.colors.primary};
  margin: auto;
  width: ${(props) => `${sizes[props.size].handleInner[0]}`};
  height: ${(props) => `${sizes[props.size].handleInner[1]}`};
  border-radius: 100%;
  box-shadow: inset 0 0 4px 0 rgb(0 0 0 / 15%);
  position: relative;
`;

const HandleMark = styled.div<StyledProps>`
  width: ${(props) => `${sizes[props.size].mark[0]}`};
  height: ${(props) => `${sizes[props.size].mark[1]}`};
  border-radius: 100%;
  background: ${theme.colors.primaryDarkMediumContrast};
  position: absolute;
  left: 16px;
  top: 2px;
`;

const Svg = styled.svg<StyledProps>`
  position: absolute;
  ${absoluteCenterXY};
  width: ${(props) => `${sizes[props.size].svg[0]}`}px;
  height: ${(props) => `${sizes[props.size].svg[1]}`}px;
  overflow: visible;
  z-index: 1;
`;

export const Handle = ({
  min = 0,
  max = 100,
  step,
  value = 0,
  size = 'm',
  onChange,
  formatValue,
  label,
  mode = 'linear',
  precision = 1000,
  plotSize = 100,
  disabled = false,
}: HandleProps) => {
  const { svg } = sizes[size];
  const prevValue = React.useRef(value);
  const mousePosition = React.useRef<Vector2D>([0, 0]);
  const { arcBackground, commonArcOptions, scale } = React.useMemo(() => {
    const { arc: arcSize } = sizes[size];
    const arcPadding = 1.2;
    const [minAngle, maxAngle] = [-Math.PI / arcPadding, Math.PI / arcPadding];
    const scale = (mode === 'linear' ? scaleLinear() : scaleLog())
      .domain(step ? [0, step.length - 1] : [min, max])
      .range([minAngle, maxAngle]);
    const commonArcOptions = {
      innerRadius: arcSize[0],
      outerRadius: arcSize[1],
      startAngle: minAngle,
    };
    const arcBackground = arc()({ ...commonArcOptions, endAngle: maxAngle }) ?? undefined;
    return { arcBackground, scale, commonArcOptions };
  }, [min, max, size, mode, step]);

  const scaleMouse = React.useMemo(
    () =>
      (mode === 'linear' ? scaleLinear() : scaleLog())
        .domain(step ? [0, step.length - 1] : [min * precision, max * precision])
        .range([-plotSize, plotSize]),
    [max, min, mode, plotSize, precision, step]
  );

  const { arcValue, rotateRad } = React.useMemo(() => {
    const rotateRad = Array.isArray(step) ? scale(step.indexOf(value)) : scale(value);
    const arcValue = arc()({ ...commonArcOptions, endAngle: rotateRad }) ?? undefined;
    return { arcValue, rotateRad };
  }, [commonArcOptions, value, scale, step]);

  const onMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      mousePosition.current = vector2d.fromMouseEvent(e);

      const mouseMove = (e: MouseEvent) => {
        if (!mousePosition.current) return;
        const current = vector2d.fromMouseEvent(e);
        const prev = mousePosition.current;
        const diff = vector2d.addition(vector2d.invertY(vector2d.subtract(current, prev)));
        const currValue = step ? scaleMouse(step.indexOf(value * precision)) : scaleMouse(value * precision);
        const currValueAbs = Math.abs(currValue);
        const tDiff = number.thresholds(diff, -plotSize - currValueAbs, plotSize + currValueAbs);
        const result = number.thresholds(
          Math.round(scaleMouse.invert(currValue + tDiff)) / precision,
          min,
          max
        );
        if (prevValue.current === result) return;
        prevValue.current = result;

        onChange?.(step ? step[result] : result);
      };
      const cleanUp = () => {
        document.removeEventListener('mousemove', mouseMove);
        document.removeEventListener('mouseup', cleanUp);
      };
      document.addEventListener('mousemove', mouseMove);
      document.addEventListener('mouseup', cleanUp);
    },
    [step, scaleMouse, value, precision, plotSize, onChange, min, max]
  );

  return (
    <Tooltip content={formatValue?.(value) ?? value}>
      <Root onMouseDown={onMouseDown} className={cls({ disabled: disabled })}>
        <HandleContainer size={size}>
          <HandleCircle style={{ transform: `rotate(${rotateRad}rad)` }} size={size}>
            <HandleCircleInner size={size}>
              <HandleMark size={size} />
            </HandleCircleInner>
          </HandleCircle>
          <HandleCircleShadow size={size} />
          <Svg size={size}>
            <path
              fill={theme.colors.primaryHighContrast}
              transform={`translate(${svg[0] / 2},${svg[1] / 2})`}
              d={arcBackground}
            />
            <path
              fill={theme.colors.accent}
              transform={`translate(${svg[0] / 2},${svg[1] / 2})`}
              d={arcValue}
            />
          </Svg>
        </HandleContainer>
        {label && <Label>{label}</Label>}
      </Root>
    </Tooltip>
  );
};
