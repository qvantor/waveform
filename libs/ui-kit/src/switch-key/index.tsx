import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import hexToRgba from 'hex-to-rgba';
import { Tooltip } from 'antd';
import { text10 } from '../common/styles';
import { theme } from '../common/constants';

export { AnchorIcon, DottedIcon, TripletIcon } from './icons';

interface Props {
  on: boolean;
  onChange?: (on: boolean) => void;
  // the full name (Triplets): the tooltip and screen readers
  name: string;
  // the short label on it (BPM), unless it shows an icon
  label?: string;
  // an icon in currentColor instead of the label (icons.tsx)
  icon?: React.ReactNode;
  // what it does, under the name in the tooltip
  hint?: string;
  // why it can't be switched, in the tooltip while it is disabled
  disabledHint?: string;
  disabled?: boolean;
  className?: string;
}

// the hover of the tooltip: a disabled button takes no mouse events (Chrome), so it takes none and its wrapper does
const Wrap = styled.span`
  flex: none;
  display: flex;
  height: 100%;
`;

const Content = styled.span`
  display: flex;
  align-items: center;
  transition: opacity 150ms, filter 150ms;

  svg {
    width: 14px;
    height: 14px;
  }
`;

// a key of a plate (SwitchKeys): transparent on it, lit green while it is on, a disabled one only its label dimmed
const Key = styled.button`
  ${text10};
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 100%;
  padding: 0 6px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: ${theme.colors.primaryDarkHighContrast};
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color 150ms, background 150ms;

  &:hover {
    background: ${hexToRgba(theme.colors.white, 0.07)};
  }

  &.on {
    color: ${theme.colors.accent};
    background: ${hexToRgba(theme.colors.accent, 0.12)};
  }

  &.on:hover {
    background: ${hexToRgba(theme.colors.accent, 0.18)};
  }

  &.on ${Content} {
    filter: drop-shadow(0 0 3px ${hexToRgba(theme.colors.accent, 0.6)});
  }

  &:disabled {
    cursor: default;
    pointer-events: none;
    background: transparent;
  }

  &:disabled ${Content} {
    opacity: 0.4;
    filter: none;
  }

  &:focus {
    outline: none;
  }
`;

const TipName = styled.div`
  font-weight: 600;
`;

const TipText = styled.div`
  font-size: 12px;
  color: ${hexToRgba(theme.colors.white, 0.75)};
`;

const TipWhy = styled(TipText)`
  color: ${theme.colors.thirdAccent};
`;

// ms a key is hovered before its tooltip shows: passing over the keys shows none
export const SWITCH_KEY_TIP_DELAY = 700;

// it takes no focus, nor does a press move it: the keys stay those of the notes (Space would switch a focused key)
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

// the keys of a plate all off (a bypassed effect), why
interface PlateOff {
  disabled: boolean;
  disabledHint?: string;
}
const PlateContext = React.createContext<PlateOff>({ disabled: false });

// a switch of a mode (BPM, the triplets of a rate): a key that lights its label while it is on; hovered a while, a
// tooltip tells its name, what it does and, disabled, why (its plate's reason first)
export const SwitchKey = ({
  on,
  onChange,
  name,
  label,
  icon,
  hint,
  disabledHint,
  disabled = false,
  className,
}: Props) => {
  const plate = React.useContext(PlateContext);
  const off = plate.disabled || disabled;
  const why = plate.disabled ? plate.disabledHint : disabledHint;
  return (
    <Tooltip
      mouseEnterDelay={SWITCH_KEY_TIP_DELAY / 1000}
      title={
        <>
          <TipName>{name}</TipName>
          {hint && <TipText>{hint}</TipText>}
          {off && why && <TipWhy>{why}</TipWhy>}
        </>
      }
    >
      <Wrap>
        <Key
          type='button'
          className={cls(className, { on })}
          aria-pressed={on}
          aria-label={name}
          disabled={off}
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => onChange?.(!on)}
        >
          <Content>{icon ?? label ?? name}</Content>
        </Key>
      </Wrap>
    </Tooltip>
  );
};

const LINE = `1px solid ${theme.colors.primaryDarkMediumContrast}`;

const Plate = styled.div`
  flex: none;
  display: flex;
  height: 100%;
  overflow: hidden;
  border-radius: 3px;
  background: ${theme.colors.primaryDark};

  & > ${Wrap} + ${Wrap} {
    border-left: ${LINE};
  }

  /* the first key across the top, larger, the others in a row under it */
  &.stack {
    flex-wrap: wrap;
  }

  &.stack > ${Wrap} {
    box-sizing: border-box;
    flex: 1 1 0;
    height: 45%;
  }

  &.stack > ${Wrap}:first-child {
    flex-basis: 100%;
    height: 55%;
    border-bottom: ${LINE};
  }

  &.stack > ${Wrap}:nth-child(2) {
    border-left: none;
  }

  /* one key alone: all of it */
  &.stack > ${Wrap}:only-child {
    height: 100%;
    border-bottom: none;
  }

  &.stack > ${Wrap}:first-child ${Key} {
    font-size: 11px;
    letter-spacing: 1px;
  }

  &.stack ${Key} {
    flex: 1 1;
    min-width: 0;
    padding: 0;
  }

  /* all of it off (a bypassed effect): faded as a whole, as the switch of a mode is */
  &[aria-disabled='true'] {
    opacity: 0.5;
  }

  &[aria-disabled='true'] ${Key}:disabled ${Content} {
    opacity: 1;
  }
`;

interface KeysProps {
  // the name of the group (Tempo)
  'aria-label': string;
  // all of its keys off (a bypassed effect): faded as a whole, every key disabled, `disabledHint` in their tooltips
  disabled?: boolean;
  disabledHint?: string;
  // the first key across the top, larger, the others in a row under it (BPM over T and D beside a knob; one key
  // alone all of it); its size is the one given
  stack?: boolean;
  className?: string;
}

// keys on one plate, a line between them (the strips of the oscillator)
export const SwitchKeys = ({
  stack = false,
  disabled = false,
  disabledHint,
  className,
  children,
  ...props
}: React.PropsWithChildren<KeysProps>) => {
  const off = React.useMemo(() => ({ disabled, disabledHint }), [disabled, disabledHint]);
  return (
    <Plate
      role='group'
      aria-disabled={disabled || undefined}
      className={cls(className, { stack })}
      {...props}
    >
      <PlateContext.Provider value={off}>{children}</PlateContext.Provider>
    </Plate>
  );
};
