import React from 'react';
import styled from 'styled-components';
import { arc } from 'd3-shape';
import cls from 'classnames';
import { number, vector2d } from '@waveform/math';
import { theme } from '../common/constants';
import { absoluteCenterX, absoluteCenterXY } from '../common/styles';
import { ScaleMode, singlePointerTracker, valueScale } from '../common/utils';
import { Tooltip } from '../tooltip';
import { ValueTooltip } from '../tooltip/value-tooltip';
import { Label } from '../label';
import { MarkCanvas, useModulations } from '../common/utils/use-mod-mark';
import { AMOUNT_DOT_SIZE, RoutesDot } from '../amount-dot';
import { MOD_DRAGGING_CLASS, MOD_OVER_ATTR, MOD_REFUSED_ATTR, MOD_TARGET_ATTR } from '../mod-drag';

// a modulation of the knob: a source (an envelope) moves it by amount, a share of its range in its scale
// (-1..1); a dot at the top left has a section of the color of each route, the route of the selected source
// shows: an arc of its color on the ring of the knob shows where to, the dot changes its amount
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
  // the steps of the amount from 0 to 1 it is dragged by (100: 1%; 48: a semitone of ±48)
  amountSteps?: number;
  // the level of the source now and whether it sounds: a mark like the knob's follows the sum of the routes
  level?: () => number | null;
  live?: boolean;
  // its source is the selected one (the ENV tab): its arc shows and the dot changes it, the others only move the
  // mark
  selected?: boolean;
  // it moves the knob around its value (amount × (level - ½): its arc ±amount / 2), else up from it; onPolarity
  // switches it (Shift+Alt+click on the knob, Shift+click or B on its dot)
  bipolar?: boolean;
  onPolarity?: (bipolar: boolean) => void;
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
  // the full name of what it changes (1–2 short words: Early reflections), in the tooltip before the value; a
  // string label by default
  name?: string;
  mode?: ScaleMode;
  precision?: number;
  plotSize?: number;
  disabled?: boolean;
  // the value the fill starts from (e.g. 0 for a bipolar knob, 1 for a stereo width), min by default; a knob that
  // takes modulations has no fill
  fillFrom?: number;
  // the routes moving the knob (hidden while it is disabled), an array (maybe empty) if it takes them: then a
  // ring on its edge shows its travel and holds the arc of a route, else an arc of its travel around it with the
  // fill
  modulations?: HandleModulation[];
  // the id a dragged source is dropped onto (MOD_TARGET_ATTR): a disabled knob takes none
  modTarget?: string;
  // a knob around a cycle (the Phase of an LFO): the routes move it around, not clamped (its mark, the arc)
  wrap?: boolean;
}

interface StyledProps {
  size: Size;
}

// px
const sizes: Record<
  Size,
  {
    // the knob in the middle
    wrapper: number;
    // the diameters of the knob (its ring starts on its edge), of its face and of its mark
    handleOuter: number;
    handleInner: number;
    mark: number;
    svg: number;
    // the inner and the outer radius of the arc of the travel of a knob that takes no modulations
    arc: [number, number];
  }
> = {
  m: { wrapper: 50, handleOuter: 34, handleInner: 32, mark: 2, svg: 30, arc: [19, 21] },
  l: { wrapper: 60, handleOuter: 44, handleInner: 42, mark: 3, svg: 40, arc: [29, 31] },
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
  width: ${(props) => sizes[props.size].wrapper}px;
  height: ${(props) => sizes[props.size].wrapper}px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
`;

const HandleCircle = styled.div<StyledProps>`
  width: ${(props) => sizes[props.size].handleOuter}px;
  height: ${(props) => sizes[props.size].handleOuter}px;
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
  width: ${(props) => sizes[props.size].handleOuter}px;
  height: ${(props) => sizes[props.size].handleOuter}px;
  border-radius: 100%;
  box-shadow: 4px 8px 28px 0 rgba(0, 0, 0, 0.35);
  z-index: 2;
`;

const HandleCircleInner = styled.div<StyledProps>`
  background: ${theme.colors.primary};
  margin: auto;
  width: ${(props) => sizes[props.size].handleInner}px;
  height: ${(props) => sizes[props.size].handleInner}px;
  border-radius: 100%;
  box-shadow: inset 0 0 4px 0 rgb(0 0 0 / 15%);
  position: relative;
`;

// the position of the knob: a dot at its edge
const HandleMark = styled.div<StyledProps>`
  width: ${(props) => sizes[props.size].mark}px;
  height: ${(props) => sizes[props.size].mark}px;
  border-radius: 100%;
  background: ${theme.colors.primaryDarkMediumContrast};
  position: absolute;
  ${absoluteCenterX};
  top: 2px;
`;

// lit while a source is dragged (mod-drag), brighter under the pointer
const ModHighlight = styled.div<StyledProps>`
  position: absolute;
  ${absoluteCenterXY};
  width: ${(props) => sizes[props.size].handleOuter}px;
  height: ${(props) => sizes[props.size].handleOuter}px;
  border-radius: 100%;
  pointer-events: none;
  z-index: 3;
  display: none;

  body.${MOD_DRAGGING_CLASS} [${MOD_TARGET_ATTR}]:not([${MOD_REFUSED_ATTR}]) > * > & {
    display: block;
    box-shadow: 0 0 0 2px var(--mod-drag-color);
  }

  body.${MOD_DRAGGING_CLASS} [${MOD_OVER_ATTR}] > * > & {
    box-shadow: 0 0 0 3px var(--mod-drag-color), 0 0 12px 3px var(--mod-drag-color);
  }
`;

// where the knob moves with its modulations now: over the knob, a canvas its mark is painted on (markCanvasOf)
const ModMark = styled.canvas<StyledProps>`
  position: absolute;
  inset: 0;
  margin: auto;
  width: ${(props) => sizes[props.size].handleOuter}px;
  height: ${(props) => sizes[props.size].handleOuter}px;
  pointer-events: none;
  z-index: 3;
`;

const Dot = styled(RoutesDot)`
  z-index: 4;
`;

// the ring of the travel on the edge of the knob, the arc of the selected route covers it
const TRACK_WIDTH = 6;
const TRACK_OPACITY = 0.4;
// px the dot of the routes goes into the ring: it sticks to it, at the top left
const DOT_OVERLAP = 1;

// over the shadow of the knob: it doesn't darken the arcs on its edge; the arc of the travel of a knob that takes
// no modulations under it
const Svg = styled.svg<StyledProps>`
  position: absolute;
  ${absoluteCenterXY};
  width: ${(props) => sizes[props.size].svg}px;
  height: ${(props) => sizes[props.size].svg}px;
  overflow: visible;
  z-index: 2;

  &.scale {
    z-index: 1;
  }
`;

// the travel of the knob, from min to max
const MIN_ANGLE = -Math.PI / 1.2;
const MAX_ANGLE = Math.PI / 1.2;
const toShare = (angle: number) => (angle - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE);
const fromShare = (share: number) => MIN_ANGLE + share * (MAX_ANGLE - MIN_ANGLE);

// a ring between two radii from one angle to another, the whole travel by default
const ringPath = (
  [innerRadius, outerRadius]: [number, number],
  startAngle = MIN_ANGLE,
  endAngle = MAX_ANGLE
) => arc()({ innerRadius, outerRadius, startAngle, endAngle }) ?? undefined;

// of a size: the radii of the ring of a knob that takes modulations (a translucent grey ring on its edge shows
// its travel, the arc of the selected route lies on it) and its path, the arc of the travel around a knob that
// takes none, and the center of the dot of the routes in the box of the knob: on the diagonal to the top left,
// on the outer edge of the ring
const shapesOf = (size: Size) => {
  const { wrapper, handleOuter, arc: travelRadii } = sizes[size];
  const ring: [number, number] = [handleOuter / 2, handleOuter / 2 + TRACK_WIDTH];
  const offset = (ring[1] + AMOUNT_DOT_SIZE / 2 - DOT_OVERLAP) * Math.SQRT1_2;
  return {
    ring,
    track: ringPath(ring),
    travel: ringPath(travelRadii),
    dot: { left: wrapper / 2 - offset, top: wrapper / 2 - offset },
  };
};
const shapes: Record<Size, ReturnType<typeof shapesOf>> = { m: shapesOf('m'), l: shapesOf('l') };

// the mark of the knob at a share of its travel, half transparent, on the canvas of its box (ModMark): the dot of
// HandleMark, 2 px into the face of the knob, turned with it from the top
const markCanvasOf = (size: Size): MarkCanvas => {
  const { handleOuter, handleInner, mark } = sizes[size];
  const center = handleOuter / 2;
  const radius = handleInner / 2 - 2 - mark / 2;
  const paint: MarkCanvas['paint'] = (context, share) => {
    const angle = fromShare(share);
    context.globalAlpha = 0.5;
    context.fillStyle = theme.colors.primaryDarkMediumContrast;
    context.beginPath();
    context.arc(
      center + radius * Math.sin(angle),
      center - radius * Math.cos(angle),
      mark / 2,
      0,
      2 * Math.PI
    );
    context.fill();
  };
  return { paint, width: handleOuter, height: handleOuter };
};
const markCanvases: Record<Size, MarkCanvas> = { m: markCanvasOf('m'), l: markCanvasOf('l') };

export const Handle = ({
  min = 0,
  max = 100,
  step,
  value = 0,
  size = 'm',
  onChange,
  formatValue,
  label,
  name = typeof label === 'string' ? label : undefined,
  mode = 'linear',
  precision = 1000,
  plotSize = 100,
  disabled = false,
  fillFrom,
  modulations: routes,
  modTarget,
  wrap = false,
}: HandleProps) => {
  const { svg, arc: travelRadii } = sizes[size];
  const { ring, track, travel, dot } = shapes[size];
  const prevValue = React.useRef(value);
  const toAngle = React.useMemo(() => {
    const scale = valueScale(mode)
      .domain(step ? [0, step.length - 1] : [min, max])
      .range([MIN_ANGLE, MAX_ANGLE]);
    return (value: number) => scale(step ? step.indexOf(value) : value);
  }, [min, max, mode, step]);

  const scaleMouse = React.useMemo(
    () =>
      valueScale(mode)
        .domain(step ? [0, step.length - 1] : [min * precision, max * precision])
        .range([-plotSize, plotSize]),
    [max, min, mode, plotSize, precision, step]
  );

  const rotateRad = toAngle(value);
  const share = toShare(rotateRad);
  const {
    modulations,
    mark: modMark,
    live,
    shown,
    spans,
  } = useModulations(routes, disabled, share, markCanvases[size], wrap);

  // a knob that takes no modulations: on the arc of its travel the fill, from fillFrom (min by default) to the
  // value, none between them
  const fill = React.useMemo(() => {
    if (routes) return undefined;
    const start = fillFrom === undefined ? MIN_ANGLE : toAngle(fillFrom);
    return start === rotateRad ? undefined : ringPath(travelRadii, start, rotateRad);
  }, [routes, fillFrom, toAngle, rotateRad, travelRadii]);

  // the selected route: from the value to the value + amount (a share of the travel), a bipolar one around it,
  // clamped to the travel or around it (two arcs over an end)
  const modArc = React.useMemo(
    () =>
      spans.length === 0
        ? undefined
        : spans.map(([from, to]) => ringPath(ring, fromShare(from), fromShare(to))).join(''),
    [spans, ring]
  );

  const [trackPointer] = React.useState(singlePointerTracker);
  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      // Shift+Alt+click: the selected route switches its polarity, the knob doesn't turn
      if (e.shiftKey && e.altKey && shown?.onPolarity) {
        shown.onPolarity(!shown.bipolar);
        return;
      }
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
    [trackPointer, step, scaleMouse, value, precision, plotSize, onChange, min, max, shown]
  );

  return (
    <Tooltip content={<ValueTooltip name={name}>{formatValue?.(value) ?? value}</ValueTooltip>}>
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
          {live && <ModMark {...modMark} size={size} data-testid='mod-mark' />}
          <Svg size={size} className={cls({ scale: !routes })}>
            <g transform={`translate(${svg / 2},${svg / 2})`}>
              {routes ? (
                <path
                  fill={theme.colors.primaryHighContrast}
                  fillOpacity={TRACK_OPACITY}
                  d={track}
                  data-testid='knob-track'
                />
              ) : (
                <>
                  <path fill={theme.colors.primaryHighContrast} d={travel} data-testid='knob-scale' />
                  {fill && <path fill={theme.colors.accent} d={fill} data-testid='knob-fill' />}
                </>
              )}
              {shown && modArc && <path fill={shown.color} d={modArc} data-testid='mod-arc' />}
            </g>
          </Svg>
          {modulations.length > 0 && <Dot modulations={modulations} style={dot} />}
        </HandleContainer>
        {label && <Label>{label}</Label>}
      </Root>
    </Tooltip>
  );
};
