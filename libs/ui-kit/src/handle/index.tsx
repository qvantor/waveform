import React from 'react';
import styled from 'styled-components';
import { arc } from 'd3-shape';
import cls from 'classnames';
import { number, vector2d } from '@waveform/math';
import { theme } from '../common/constants';
import { absoluteCenterXY } from '../common/styles';
import { ScaleMode, singlePointerTracker, valueScale } from '../common/utils';
import { Tooltip } from '../tooltip';
import { ValueTooltipContent } from '../tooltip/value-tooltip';
import { Label } from '../label';
import { AmountRing, AMOUNT_RING_SIZE } from '../amount-ring';
import { MOD_DRAGGING_CLASS, MOD_OVER_ATTR, MOD_TARGET_ATTR } from '../mod-drag';

// a modulation of the knob: a source (an envelope) moves it by amount, a share of its range in its scale
// (-1..1); an arc of the color of the source outside the scale shows where to, a ring next to the knob changes
// the amount
export interface HandleModulation {
  id: string;
  color: string;
  amount: number;
  // the name of the source
  label?: string;
  onChange?: (amount: number) => void;
  onRemove?: () => void;
  // the amount in the units of the knob (+2.4 oct, +35%)
  formatAmount?: (amount: number) => React.ReactNode;
  // the level of the source now and whether it sounds: a dot follows it on the ring (AmountRing)
  level?: () => number | null;
  live?: boolean;
}

type Size = 'm' | 'l';

export interface HandleProps {
  min?: number;
  max?: number;
  value?: number;
  step?: number[];
  size?: Size;
  onChange?: (value: number) => void;
  formatValue?: (value: number) => React.ReactNode;
  label?: React.ReactNode;
  mode?: ScaleMode;
  precision?: number;
  plotSize?: number;
  disabled?: boolean;
  // the value the fill starts from (e.g. 0 for a bipolar knob), min by default
  fillFrom?: number;
  // the routes moving the knob (hidden while it is disabled)
  modulations?: HandleModulation[];
  // the id a dragged source is dropped onto (MOD_TARGET_ATTR): a disabled knob takes none
  modTarget?: string;
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
  touch-action: none;

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

// lit while a source is dragged (mod-drag), brighter under the pointer
const ModHighlight = styled.div<StyledProps>`
  position: absolute;
  ${absoluteCenterXY};
  width: ${(props) => `${sizes[props.size].handleOuter[0]}`};
  height: ${(props) => `${sizes[props.size].handleOuter[1]}`};
  border-radius: 100%;
  pointer-events: none;
  z-index: 3;
  display: none;

  body.${MOD_DRAGGING_CLASS} [${MOD_TARGET_ATTR}] > * > & {
    display: block;
    box-shadow: 0 0 0 2px var(--mod-drag-color);
  }

  body.${MOD_DRAGGING_CLASS} [${MOD_OVER_ATTR}] > * > & {
    box-shadow: 0 0 0 3px var(--mod-drag-color), 0 0 12px 3px var(--mod-drag-color);
  }
`;

// the rings of the modulations at the corners of the knob, clockwise from the top right one
const RING_CORNERS: React.CSSProperties[] = [
  { right: -AMOUNT_RING_SIZE / 2, top: -AMOUNT_RING_SIZE / 2 },
  { left: -AMOUNT_RING_SIZE / 2, top: -AMOUNT_RING_SIZE / 2 },
  { right: -AMOUNT_RING_SIZE / 2, bottom: 0 },
  { left: -AMOUNT_RING_SIZE / 2, bottom: 0 },
];

const Ring = styled(AmountRing)`
  position: absolute;
  z-index: 4;
`;

// px between the scale and the first arc of a modulation, the width of an arc and the step to the next one
const MOD_ARC_GAP = 1.5;
const MOD_ARC_WIDTH = 2;
const MOD_ARC_STEP = 2.5;

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
  fillFrom,
  modulations = [],
  modTarget,
}: HandleProps) => {
  const { svg } = sizes[size];
  const prevValue = React.useRef(value);
  const { arcBackground, commonArcOptions, toAngle, fillStartAngle, angles } = React.useMemo(() => {
    const { arc: arcSize } = sizes[size];
    const arcPadding = 1.2;
    const [minAngle, maxAngle] = [-Math.PI / arcPadding, Math.PI / arcPadding];
    const scale = valueScale(mode)
      .domain(step ? [0, step.length - 1] : [min, max])
      .range([minAngle, maxAngle]);
    const toAngle = (value: number) => scale(step ? step.indexOf(value) : value);
    const commonArcOptions = {
      innerRadius: arcSize[0],
      outerRadius: arcSize[1],
      startAngle: minAngle,
    };
    const arcBackground = arc()({ ...commonArcOptions, endAngle: maxAngle }) ?? undefined;
    const fillStartAngle = fillFrom === undefined ? minAngle : toAngle(fillFrom);
    return { arcBackground, commonArcOptions, toAngle, fillStartAngle, angles: [minAngle, maxAngle] };
  }, [min, max, size, mode, step, fillFrom]);

  const scaleMouse = React.useMemo(
    () =>
      valueScale(mode)
        .domain(step ? [0, step.length - 1] : [min * precision, max * precision])
        .range([-plotSize, plotSize]),
    [max, min, mode, plotSize, precision, step]
  );

  const { arcValue, rotateRad } = React.useMemo(() => {
    const rotateRad = toAngle(value);
    // no fill at the start point: only the background arc is visible
    const arcValue =
      rotateRad !== fillStartAngle
        ? arc()({ ...commonArcOptions, startAngle: fillStartAngle, endAngle: rotateRad }) ?? undefined
        : undefined;
    return { arcValue, rotateRad };
  }, [commonArcOptions, value, toAngle, fillStartAngle]);

  // a modulation: from the value to the value + amount (a share of the travel), clamped to the scale
  const modArcs = disabled
    ? []
    : modulations.map(({ id, color, amount }, index) => {
        const [minAngle, maxAngle] = angles;
        const share = (rotateRad - minAngle) / (maxAngle - minAngle);
        const end = minAngle + number.thresholds(share + amount, 0, 1) * (maxAngle - minAngle);
        const innerRadius = commonArcOptions.outerRadius + MOD_ARC_GAP + index * MOD_ARC_STEP;
        const path =
          end === rotateRad
            ? undefined
            : arc()({
                innerRadius,
                outerRadius: innerRadius + MOD_ARC_WIDTH,
                startAngle: Math.min(rotateRad, end),
                endAngle: Math.max(rotateRad, end),
              }) ?? undefined;
        return { id, color, path };
      });

  const [trackPointer] = React.useState(singlePointerTracker);
  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      const initialPosition = vector2d.fromMouseEvent(e);
      trackPointer(e, (e) => {
        const current = vector2d.fromMouseEvent(e);
        const diff = vector2d.addition(vector2d.invertY(vector2d.subtract(current, initialPosition)));
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
      });
    },
    [trackPointer, step, scaleMouse, value, precision, plotSize, onChange, min, max]
  );

  return (
    <Tooltip content={<ValueTooltipContent>{formatValue?.(value) ?? value}</ValueTooltipContent>}>
      <Root
        onPointerDown={onPointerDown}
        className={cls({ disabled: disabled })}
        {...(modTarget && !disabled && { [MOD_TARGET_ATTR]: modTarget })}
      >
        <HandleContainer size={size}>
          <ModHighlight size={size} />
          <HandleCircle style={{ transform: `rotate(${rotateRad}rad)` }} size={size}>
            <HandleCircleInner size={size}>
              <HandleMark size={size} />
            </HandleCircleInner>
          </HandleCircle>
          <HandleCircleShadow size={size} />
          <Svg size={size}>
            <g transform={`translate(${svg[0] / 2},${svg[1] / 2})`}>
              <path fill={theme.colors.primaryHighContrast} d={arcBackground} />
              {arcValue && <path fill={theme.colors.accent} d={arcValue} />}
              {modArcs.map(
                ({ id, color, path }) => path && <path key={id} fill={color} d={path} data-testid='mod-arc' />
              )}
            </g>
          </Svg>
          {!disabled &&
            modulations
              .slice(0, RING_CORNERS.length)
              .map(({ id, label: source, onChange: onAmount, ...ring }, index) => (
                <Ring key={id} {...ring} label={source} onChange={onAmount} style={RING_CORNERS[index]} />
              ))}
        </HandleContainer>
        {label && <Label>{label}</Label>}
      </Root>
    </Tooltip>
  );
};
