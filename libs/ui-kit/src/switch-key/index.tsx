import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { text10 } from '../common/styles';
import { theme } from '../common/constants';

interface Props {
  on: boolean;
  onChange?: (on: boolean) => void;
  // the short label on it (BPM, T)
  label: string;
  // the full name (Triplets), the label by default
  name?: string;
  disabled?: boolean;
  className?: string;
}

// a small key of a screen, its label lit while it is on
const Root = styled.button`
  ${text10};
  flex: none;
  min-width: 22px;
  height: 100%;
  padding: 0 5px;
  border: none;
  border-radius: 3px;
  background: ${theme.colors.primaryDark};
  color: ${theme.colors.primaryDarkHighContrast};
  font-weight: 600;
  letter-spacing: 1px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color 150ms, background 150ms;

  &:hover {
    background: ${theme.colors.primaryDarkMediumContrast};
  }

  &.on {
    color: ${theme.colors.accent};
  }

  &:disabled {
    cursor: default;
    opacity: 0.4;
    background: ${theme.colors.primaryDark};
  }

  &:focus {
    outline: none;
  }

  &:focus-visible {
    outline: 1px solid ${theme.colors.secondAccent};
  }
`;

// a switch of a mode (BPM, the triplets of a rate): a key that lights its label while it is on
export const SwitchKey = ({ on, onChange, label, name = label, disabled = false, className }: Props) => (
  <Root
    type='button'
    className={cls(className, { on })}
    aria-pressed={on}
    aria-label={name}
    title={name}
    disabled={disabled}
    onClick={() => onChange?.(!on)}
  >
    {label}
  </Root>
);
