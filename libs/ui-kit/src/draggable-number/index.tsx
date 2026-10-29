import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import hexToRgba from 'hex-to-rgba';
import { number, vector2d, Vector2D } from '@waveform/math';
import { text10 } from '../common/styles';
import { theme } from '../common/constants';
import { useElementSize } from '../common/hooks';
import { singlePointerTracker } from '../common/utils';
import { MarkCanvas, useModulations } from '../common/utils/use-mod-mark';
import type { HandleModulation } from '../handle';
import { RoutesDot } from '../amount-dot';
import { MOD_DRAGGING_CLASS, MOD_OVER_ATTR, MOD_REFUSED_ATTR, MOD_TARGET_ATTR } from '../mod-drag';
import { StepArrows } from './step-arrows';

interface Props {
  value: number;
  onChange?: (value: number) => void;
  label?: string;
  range?: Vector2D;
  // px of drag a step (10: an octave of Oct; 2: a cent of Fine, ±100 in 400 px)
  pxPerStep?: number;
  // smaller, without the carets (a narrow row)
  compact?: boolean;
  // the routes moving what it sets (hidden while it has none), an array (maybe empty) if it takes them: a line
  // along its bottom holds the bar of the selected route and the mark of the live ones (the value in its middle,
  // ±1 of an amount at its ends), a dot at its top left changes the selected one; the number stays its own value
  modulations?: HandleModulation[];
  // the id a dragged source is dropped onto (MOD_TARGET_ATTR)
  modTarget?: string;
}

// px of the line of the routes: from the sides, from the bottom, its height; the canvas of the mark around it
const TRACK_INSET = 4;
const TRACK_BOTTOM = 2;
const TRACK_HEIGHT = 2;
const MARK_HEIGHT = 6;

const Root = styled.div`
  position: relative;
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

  &.compact {
    font-size: 10px;
    line-height: 12px;
    gap: 4px;
    padding: 5px 4px;
  }
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

const Track = styled.div`
  position: absolute;
  left: ${TRACK_INSET}px;
  right: ${TRACK_INSET}px;
  bottom: ${TRACK_BOTTOM}px;
  height: ${TRACK_HEIGHT}px;
  border-radius: 1px;
  background: ${hexToRgba(theme.colors.white, 0.12)};
  pointer-events: none;
`;

// the selected route: of the color of its source, from the middle to the amount (a bipolar one around it)
const ModBar = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 1px;
`;

// where the live routes move what it sets now: a canvas over the line the mark is painted on (MarkCanvas)
const ModMark = styled.canvas`
  position: absolute;
  left: ${TRACK_INSET}px;
  bottom: ${TRACK_BOTTOM + TRACK_HEIGHT / 2 - MARK_HEIGHT / 2}px;
  height: ${MARK_HEIGHT}px;
  pointer-events: none;
`;

// the dot of the routes, centered on the top left corner
const DotBox = styled.div`
  position: absolute;
  left: 0;
  top: 0;
`;

const Dot = styled(RoutesDot)`
  left: 0;
  top: 0;
`;

// lit while a source is dragged (mod-drag), brighter under the pointer
const ModHighlight = styled.div`
  position: absolute;
  inset: 0;
  border-radius: 3px;
  pointer-events: none;
  display: none;

  body.${MOD_DRAGGING_CLASS} [${MOD_TARGET_ATTR}]:not([${MOD_REFUSED_ATTR}]) > & {
    display: block;
    box-shadow: 0 0 0 2px var(--mod-drag-color);
  }

  body.${MOD_DRAGGING_CLASS} [${MOD_OVER_ATTR}] > & {
    box-shadow: 0 0 0 3px var(--mod-drag-color), 0 0 12px 3px var(--mod-drag-color);
  }
`;

const NO_ROUTES: HandleModulation[] = [];

// the mark at a share of the line of `width` px: a tick across it, half transparent
const markCanvas = (width: number): MarkCanvas => ({
  paint: (context, share) => {
    context.globalAlpha = 0.5;
    context.fillStyle = theme.colors.white;
    context.fillRect(number.thresholds(share * width, 1, width - 1) - 1, 0, 2, MARK_HEIGHT);
  },
  width,
  height: MARK_HEIGHT,
});

// a whole number dragged up or down; with routes (Pitch on Semi, Fine) the line of their travel along its bottom
export const DraggableNumber = ({
  value,
  onChange,
  label,
  range = [0, 10],
  pxPerStep = 10,
  compact = false,
  modulations: routes,
  modTarget,
}: Props) => {
  const [active, setActive] = React.useState(false);
  const [trackPointer] = React.useState(singlePointerTracker);
  const [trackRef, [trackWidth]] = useElementSize<HTMLDivElement>();
  const own = routes ?? NO_ROUTES;
  // the line is ±1 of an amount from its middle: a route moves the mark and its bar by half its amount
  const halved = React.useMemo(() => own.map((route) => ({ ...route, amount: route.amount / 2 })), [own]);
  const mark = React.useMemo(() => markCanvas(trackWidth), [trackWidth]);
  const { mark: modMark, live, shown, spans } = useModulations(halved, false, 0.5, mark);
  const [span] = spans;
  const onPointerDown = (e: React.PointerEvent) => {
    // Shift+Alt+click: the selected route switches its polarity, the value doesn't move
    if (e.shiftKey && e.altKey && shown?.onPolarity) {
      shown.onPolarity(!shown.bipolar);
      return;
    }
    const initial = vector2d.fromMouseEvent(e);
    const tracked = trackPointer(
      e,
      (e) => {
        const [, diffY] = vector2d.invertY(vector2d.subtract(vector2d.fromMouseEvent(e), initial));
        onChange?.(number.thresholds(value + Math.round(diffY / pxPerStep), ...range));
      },
      () => setActive(false)
    );
    if (tracked) setActive(true);
  };
  return (
    <Root
      className={cls({ compact })}
      onPointerDown={onPointerDown}
      {...(modTarget && { [MOD_TARGET_ATTR]: modTarget })}
    >
      <Label>{label}</Label>
      <ValueContainer>
        <Value style={{ width: `${Math.max(...range.map((end) => String(end).length))}ch` }}>{value}</Value>
        {!compact && <StepArrows active={active} />}
      </ValueContainer>
      {routes && (
        <Track ref={trackRef} data-testid='mod-track'>
          {shown && span && (
            <ModBar
              data-testid='mod-bar'
              style={{
                background: shown.color,
                left: `${span[0] * 100}%`,
                width: `${(span[1] - span[0]) * 100}%`,
              }}
            />
          )}
        </Track>
      )}
      {live && <ModMark {...modMark} style={{ width: trackWidth }} data-testid='number-mod-mark' />}
      {own.length > 0 && (
        <DotBox>
          <Dot modulations={own} />
        </DotBox>
      )}
      <ModHighlight />
    </Root>
  );
};
