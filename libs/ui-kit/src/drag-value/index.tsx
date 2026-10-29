import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import hexToRgba from 'hex-to-rgba';
import { number } from '@waveform/math';
import { text12 } from '../common/styles';
import { theme } from '../common/constants';
import { useElementSize } from '../common/hooks';
import { singlePointerTracker } from '../common/utils';
import { MarkCanvas, useModulations } from '../common/utils/use-mod-mark';
import type { HandleModulation } from '../handle';
import { AMOUNT_DOT_SIZE, RoutesDot } from '../amount-dot';
import { MOD_TARGET_ATTR } from '../mod-drag';
import { modDragHighlight } from '../mod-drag/highlight';
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
  // the routes moving what it sets (hidden while it has none), an array (maybe empty) if it takes them: a line
  // along its bottom, its range, holds the bar of the selected route from the value and the mark of the live
  // ones, the dot right of the value changes the selected one; the value stays its own
  modulations?: HandleModulation[];
  // the share of its range an amount of 1 moves it over (Pitch on Semi: 48 of its 24 semitones, 2)
  modSpan?: number;
  // the id a dragged source is dropped onto (MOD_TARGET_ATTR)
  modTarget?: string;
  className?: string;
}

// keyboard steps as parts of the range
const PAGE_STEP = 0.1;
// px of the line of the routes along its bottom, the mark a light dot as high as it
const TRACK_HEIGHT = 4;
const MARK_RADIUS = TRACK_HEIGHT / 2;
const MARK_ALPHA = 0.9;

const Root = styled.div`
  ${text12};
  position: relative;
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
  text-align: right;
  transition: color 150ms;

  .active > & {
    color: ${theme.colors.accent};
  }
`;

// the range of the value, as wide as it
const Track = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${TRACK_HEIGHT}px;
  background: ${hexToRgba(theme.colors.white, 0.2)};
  pointer-events: none;
`;

// the selected route: of the color of its source, from the value by its amount (a bipolar one around it)
const ModBar = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
`;

// where the live routes move the value now: a canvas over the line the mark is painted on (MarkCanvas)
const ModMark = styled.canvas`
  position: absolute;
  left: 0;
  bottom: 0;
  height: ${TRACK_HEIGHT}px;
  pointer-events: none;
`;

// the place of the dot of the routes right of the value, in its row, kept without routes: the value doesn't move
// when the first one comes (the hit area of the dot over it doesn't make the row higher); a press is on the value
// or on the dot, never both
const DotSlot = styled.div`
  position: relative;
  flex: none;
  align-self: center;
  width: ${AMOUNT_DOT_SIZE}px;
  height: ${AMOUNT_DOT_SIZE}px;
  margin-left: 3px;
`;

// the dot centered in its place
const DOT_IN_SLOT: React.CSSProperties = { left: '50%', top: '50%' };

// inside its box: a strip of values clips what is out of it
const ModHighlight = styled.div`
  position: absolute;
  inset: 3px;
  border-radius: 3px;
  ${modDragHighlight('>')}
`;

// the mark at a share of the line of `width` px: a light dot on it, within it
const markCanvas = (width: number): MarkCanvas => ({
  paint: (context, share) => {
    context.globalAlpha = MARK_ALPHA;
    context.fillStyle = theme.colors.white;
    context.beginPath();
    context.arc(
      number.thresholds(share * width, MARK_RADIUS, width - MARK_RADIUS),
      MARK_RADIUS,
      MARK_RADIUS,
      0,
      2 * Math.PI
    );
    context.fill();
  },
  width,
  height: TRACK_HEIGHT,
});

// a value shown as text, pressed and dragged to change it: right or up raises it, left or down lowers it
// (both add up); arrows and page up/down when focused. With routes (Pitch on Semi, Fine) the line of its range
// along its bottom
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
  modulations: routes,
  modSpan = 1,
  modTarget,
  className,
}: DragValueProps) => {
  const [active, setActive] = React.useState(false);
  const [trackPointer] = React.useState(singlePointerTracker);
  const lastValue = React.useRef(value);
  const [trackRef, [trackWidth]] = useElementSize<HTMLDivElement>();
  // an amount in shares of its range
  const spanned = React.useMemo(
    () => routes?.map((route) => ({ ...route, amount: route.amount * modSpan })),
    [routes, modSpan]
  );
  const mark = React.useMemo(() => markCanvas(trackWidth), [trackWidth]);
  const position = max > min ? (value - min) / (max - min) : 0;
  const { mark: modMark, live, shown, spans } = useModulations(spanned, false, position, mark);
  const [span] = spans;
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
    // Shift+Alt+click: the selected route switches its polarity, the value doesn't move
    if (e.shiftKey && e.altKey && shown?.onPolarity) {
      shown.onPolarity(!shown.bipolar);
      return;
    }
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
  // a plain whole number is as wide as the widest end of its range: it doesn't widen while dragged
  const wholeNumber = !formatValue && precision === 1;
  return (
    <Root
      className={cls(className, { editable, active })}
      {...(modTarget && { [MOD_TARGET_ATTR]: modTarget })}
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
      <Value style={wholeNumber ? { width: `${Math.max(`${min}`.length, `${max}`.length)}ch` } : undefined}>
        {formatted}
      </Value>
      {arrows && <StepArrows active={active} />}
      {routes && (
        <DotSlot data-testid='mod-dot-slot'>
          {routes.length > 0 && <RoutesDot modulations={routes} style={DOT_IN_SLOT} />}
        </DotSlot>
      )}
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
      {live && <ModMark {...modMark} style={{ width: trackWidth }} data-testid='value-mod-mark' />}
      {modTarget && <ModHighlight />}
    </Root>
  );
};
