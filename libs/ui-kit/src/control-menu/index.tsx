import React from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';
import cls from 'classnames';
import hexToRgba from 'hex-to-rgba';
import { CloseOutlined, UndoOutlined } from '@ant-design/icons';
import { number } from '@waveform/math';
import { theme } from '../common/constants';
import { text10, text12, textBold12 } from '../common/styles';
import { singlePointerTracker } from '../common/utils';
import { OFF_OPACITY } from '../common/utils/mod-routes';
import { Lamp } from '../lamp';
import { AMOUNT_TRAVEL, amountText, LONG_PRESS, stepAmount, STILL } from '../amount-dot';
import type { HandleModulation } from '../handle';

// what the menu of a control shows and changes
export interface ControlMenuProps {
  // the name of the control and its value now, in the header
  name?: string;
  value: number;
  formatValue?: (value: number) => React.ReactNode;
  // the value of an empty preset: Default sets it, within min..max
  defaultValue?: number;
  min?: number;
  max?: number;
  onChange?: (value: number) => void;
  // the routes on it, an array (maybe empty) if it takes them: the amount of each dragged on its row, each
  // switched on or off, bipolar or not, removed; Clear modulation removes them all
  modulations?: HandleModulation[];
  onClearModulations?: () => void;
}

// px of the menu, its distance from the control and from the edges of the viewport
const WIDTH = 232;
const GAP = 6;
const EDGE = 8;

const Panel = styled.div`
  position: fixed;
  z-index: 60;
  box-sizing: border-box;
  width: ${WIDTH}px;
  max-width: calc(100vw - ${2 * EDGE}px);
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: ${theme.colors.primary};
  border-radius: ${theme.borderRadius.l};
  box-shadow: 0 3px 8px rgb(0 0 0 / 35%);
  color: ${theme.colors.primaryDarkMediumContrast};
  ${text12};
  touch-action: manipulation;
  -webkit-touch-callout: none;
`;

// as the header of a section
const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 5px;
  border-radius: 3px;
  background: ${theme.colors.primaryLowContrast};
  color: ${theme.colors.white};
  ${textBold12};
  white-space: nowrap;
`;

const Name = styled.span`
  flex: 1 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HeaderValue = styled.span`
  font-weight: 400;
  font-variant-numeric: tabular-nums;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding-right: 2px;

  & + & {
    border-top: 1px solid ${hexToRgba(theme.colors.primaryLowContrast, 0.6)};
  }

  @media (pointer: coarse) {
    min-height: 36px;
  }
`;

// the source and the amount of a route, dragged as a value of a strip: right or up raises the amount, left or
// down lowers it (AMOUNT_TRAVEL px from -100% to +100%, as its dot); the line under them shows it from its middle
const AmountDrag = styled.div`
  position: relative;
  flex: 1 1;
  min-width: 0;
  align-self: stretch;
  margin: 2px 0;
  padding: 0 5px;
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 3px;
  transition: background 150ms;

  &.editable {
    cursor: ew-resize;
    touch-action: none;

    /* light, as the header of the panel: the panel is light */
    &:hover,
    &.active {
      background: ${hexToRgba(theme.colors.primaryLowContrast, 0.45)};
    }
  }

  /* a route switched off: its dot, source and amount faded */
  .off & > span {
    opacity: 0.5;
  }
`;

// as the dot of a source tab: its color in a white ring
const SourceDot = styled.span`
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px ${theme.colors.white};
`;

const Source = styled.span`
  font-weight: 600;
  white-space: nowrap;
`;

const Amount = styled.span`
  flex: 1 1;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

// -100%..+100% along the row, 0 in its middle (a tick over the amount): light, as the header of the panel, every
// color of a source darker than it
const AmountLine = styled.div`
  position: absolute;
  left: 5px;
  right: 5px;
  bottom: 1px;
  height: 4px;
  border-radius: 2px;
  background: ${theme.colors.primaryLowContrast};
  pointer-events: none;

  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    margin-left: -0.5px;
    background: ${theme.colors.primaryHighContrast};
  }
`;

// the amount, of the color of the source, from the middle
const AmountFill = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2px;

  .off & {
    opacity: ${OFF_OPACITY};
  }
`;

// Uni | Bi on a small dark screen, as the mode switches
const Polarity = styled.div`
  flex: none;
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: ${theme.borderRadius.m};
  background: ${theme.colors.primaryDark};
  box-shadow: inset 0 1px 4px rgb(0 0 0 / 60%);
`;

const PolarityOption = styled.button`
  padding: 3px 5px;
  border: none;
  border-radius: ${theme.borderRadius.s};
  background: transparent;
  color: ${theme.colors.primaryHighContrast};
  ${text10};
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &.current {
    background: ${theme.colors.primaryDarkMediumContrast};
    color: ${theme.colors.secondAccent};
    cursor: default;
  }

  @media (pointer: coarse) {
    padding: 6px 7px;
  }
`;

const Remove = styled.button`
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: ${theme.borderRadius.s};
  background: none;
  color: ${theme.colors.primaryHighContrast};
  font-size: 11px;
  cursor: pointer;
  transition: color 150ms;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    color: ${theme.colors.red};
  }

  @media (pointer: coarse) {
    width: 30px;
    height: 30px;
  }
`;

const Hint = styled.p`
  ${text10};
  line-height: 13px;
  padding: 2px 5px;
  color: ${theme.colors.primaryHighContrast};
`;

// as the arrows of the mode switches: dark keys
const Action = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: none;
  border-radius: ${theme.borderRadius.m};
  background: ${theme.colors.primaryDark};
  color: ${theme.colors.white};
  ${textBold12};
  white-space: nowrap;
  cursor: pointer;
  transition: background 150ms;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: ${theme.colors.primaryDarkHighContrast};
  }

  &:active {
    background: ${theme.colors.primaryDarkMediumContrast};
  }

  &:disabled {
    background: ${theme.colors.primaryDark};
    color: ${theme.colors.primaryHighContrast};
    cursor: default;
  }

  @media (pointer: coarse) {
    padding: 9px 8px;
  }
`;

const ActionValue = styled.span`
  margin-left: auto;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: ${theme.colors.primaryLowContrast};
`;

// the events of the menu stay in it: React bubbles them through the portal to the control it belongs to (a press
// would turn the knob), a press takes no focus (the keys stay those of the notes), a right click opens no other menu
const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const stopDefault = (e: React.SyntheticEvent) => {
  e.stopPropagation();
  e.preventDefault();
};
const ISOLATED: React.HTMLAttributes<HTMLDivElement> = {
  onPointerDown: stop,
  onClick: stop,
  onDoubleClick: stop,
  onKeyDown: stop,
  onMouseDown: stopDefault,
  onContextMenu: stopDefault,
};

const sameValue = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

const POLARITIES = [
  ['Uni', false],
  ['Bi', true],
] as const;

const RouteRow = ({ route }: { route: HandleModulation }) => {
  const { label = route.id, color, amount, bipolar = false, off, formatAmount } = route;
  const { onChange, onPolarity, onOff, onRemove } = route;
  const [trackPointer] = React.useState(singlePointerTracker);
  const [active, setActive] = React.useState(false);
  const last = React.useRef(amount);
  const shown = amountText(amount, bipolar, formatAmount);

  // from the amount it had when pressed, by 1%, within -100%..+100%
  const onPointerDown = (e: React.PointerEvent) => {
    if (!onChange) return;
    last.current = amount;
    const [startX, startY] = [e.clientX, e.clientY];
    const tracked = trackPointer(
      e,
      (move) => {
        const diff = move.clientX - startX - (move.clientY - startY);
        const next = stepAmount(amount + (diff * 2) / AMOUNT_TRAVEL);
        if (next === last.current) return;
        last.current = next;
        onChange(next);
      },
      () => setActive(false)
    );
    if (tracked) setActive(true);
  };

  return (
    <Row className={cls({ off })} data-testid='menu-route'>
      <AmountDrag
        className={cls({ editable: !!onChange, active })}
        {...(onChange && {
          role: 'slider',
          'aria-label': `${label} amount`,
          'aria-valuemin': -100,
          'aria-valuemax': 100,
          'aria-valuenow': Math.round(amount * 100),
          ...(typeof shown === 'string' && { 'aria-valuetext': shown }),
          onPointerDown,
        })}
      >
        <SourceDot style={{ background: color }} />
        <Source>{label}</Source>
        <Amount>{shown}</Amount>
        <AmountLine>
          <AmountFill
            data-testid='menu-route-amount'
            style={{
              background: color,
              left: `${50 + Math.min(0, amount) * 50}%`,
              width: `${Math.abs(amount) * 50}%`,
            }}
          />
        </AmountLine>
      </AmountDrag>
      {onPolarity && (
        <Polarity role='group' aria-label={`${label} polarity`}>
          {POLARITIES.map(([name, value]) => (
            <PolarityOption
              key={name}
              type='button'
              className={cls({ current: bipolar === value })}
              aria-pressed={bipolar === value}
              onClick={() => bipolar !== value && onPolarity(value)}
            >
              {name}
            </PolarityOption>
          ))}
        </Polarity>
      )}
      {onOff && <Lamp on={!off} color={color} label={`${label} on`} onChange={(on) => onOff(!on)} />}
      {onRemove && (
        <Remove type='button' aria-label={`Remove ${label}`} onClick={onRemove}>
          <CloseOutlined aria-hidden />
        </Remove>
      )}
    </Row>
  );
};

// the menu of a control under it (over it where it doesn't fit), within the viewport: the routes on it, Default
// and Clear modulation (with a route at least); closed by a press out of it, Escape, a scroll, a new size of the
// window or its blur
const ControlMenu = ({
  anchor,
  onClose,
  name,
  value,
  formatValue,
  defaultValue,
  min = -Infinity,
  max = Infinity,
  onChange,
  modulations,
  onClearModulations,
}: ControlMenuProps & { anchor: DOMRect; onClose: () => void }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [place, setPlace] = React.useState<{ left: number; top: number } | null>(null);

  // laid out again with every route removed (it gets lower; over the control it stays next to it)
  const rows = modulations?.length;
  React.useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const { clientWidth, clientHeight } = document.documentElement;
    const { offsetWidth: width, offsetHeight: height } = panel;
    const left = number.thresholds(
      anchor.left + anchor.width / 2 - width / 2,
      EDGE,
      Math.max(EDGE, clientWidth - EDGE - width)
    );
    const below = anchor.bottom + GAP;
    const top = below + height <= clientHeight - EDGE ? below : Math.max(EDGE, anchor.top - GAP - height);
    setPlace((last) => (last?.left === left && last.top === top ? last : { left, top }));
  }, [anchor, rows]);

  React.useEffect(() => {
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const format = (shown: number) => formatValue?.(shown) ?? shown;
  const reset = defaultValue === undefined ? undefined : number.thresholds(defaultValue, min, max);
  return ReactDOM.createPortal(
    <Panel
      ref={ref}
      role='dialog'
      aria-label={name}
      style={place ?? { left: 0, top: 0, visibility: 'hidden' }}
      {...ISOLATED}
    >
      <Header>
        <Name>{name}</Name>
        <HeaderValue>{format(value)}</HeaderValue>
      </Header>
      {rows ? (
        <div>
          {modulations?.map((route) => (
            <RouteRow key={route.id} route={route} />
          ))}
        </div>
      ) : null}
      {rows === 0 && <Hint>Drag a source tab here to add a modulation</Hint>}
      {reset !== undefined && onChange && (
        <Action
          type='button'
          disabled={sameValue(value, reset)}
          onClick={() => {
            onChange(reset);
            onClose();
          }}
        >
          <UndoOutlined aria-hidden />
          Default
          <ActionValue>{format(reset)}</ActionValue>
        </Action>
      )}
      {rows ? (
        <Action
          type='button'
          disabled={!onClearModulations}
          onClick={() => {
            onClearModulations?.();
            onClose();
          }}
        >
          <CloseOutlined aria-hidden />
          Clear modulation
        </Action>
      ) : null}
    </Panel>,
    document.body
  );
};

// the menu of a control (a knob, a fader, a value): opened by a right click (onContextMenu: also Ctrl+click, the menu
// key, a long press of Android), by a long press on a touch screen (a press `track` follows: held still LONG_PRESS
// ms, within STILL px) or by its dot of the routes (`open`); `anchorRef` on the box it opens under, `menu` rendered
// with the control. A control without a default nor routes has none: its right click is the browser's
export const useControlMenu = (props: ControlMenuProps) => {
  const enabled = props.modulations !== undefined || (props.defaultValue !== undefined && !!props.onChange);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null);
  const [trackPointer] = React.useState(singlePointerTracker);
  // the press of the control while it is held: taken once the menu opens
  const held = React.useRef<{ taken: boolean } | null>(null);

  const open = React.useCallback(() => {
    const element = anchorRef.current;
    if (!element) return;
    if (held.current) held.current.taken = true;
    setAnchor(element.getBoundingClientRect());
  }, []);
  const close = React.useCallback(() => setAnchor(null), []);

  const onContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      open();
    },
    [open]
  );

  // a press of the control from its pointerdown, followed while it is held (one pointer, the main button): `onMove`
  // while it moves the control, `onEnd` when it is let go (`tapped`: a finger let go where it was pressed, the menu
  // didn't open). A press the menu opened from moves the control no more, a finger moves it only once past STILL px
  // (`waits`: held still it changes nothing before the menu opens). Shift+Alt+click switches the polarity of the
  // selected route, the control doesn't move. False when the press isn't followed
  const track = (
    e: React.PointerEvent,
    onMove: (move: PointerEvent) => void,
    onEnd?: (tapped: boolean) => void
  ) => {
    const shown = props.modulations?.find(({ selected }) => selected);
    if (e.button === 0 && e.shiftKey && e.altKey && shown?.onPolarity) {
      shown.onPolarity(!shown.bipolar);
      return false;
    }
    const { clientX, clientY } = e;
    const waits = enabled && (e.pointerType === 'touch' || e.pointerType === 'pen');
    const press = { taken: false };
    let still = waits;
    let timer: number | undefined;
    const tracked = trackPointer(
      e,
      (move) => {
        if (press.taken) return;
        if (still && Math.hypot(move.clientX - clientX, move.clientY - clientY) > STILL) {
          still = false;
          window.clearTimeout(timer);
        }
        if (!still) onMove(move);
      },
      () => {
        window.clearTimeout(timer);
        if (held.current === press) held.current = null;
        onEnd?.(still && !press.taken);
      }
    );
    if (!tracked) return false;
    held.current = press;
    if (waits) timer = window.setTimeout(() => still && open(), LONG_PRESS);
    return { waits };
  };

  return {
    anchorRef,
    open: enabled ? open : undefined,
    onContextMenu: enabled ? onContextMenu : undefined,
    track,
    menu: enabled && anchor ? <ControlMenu {...props} anchor={anchor} onClose={close} /> : null,
  };
};
