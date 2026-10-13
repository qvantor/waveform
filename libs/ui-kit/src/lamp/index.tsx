import React from 'react';
import cls from 'classnames';
import styled from 'styled-components';
import hexToRgba from 'hex-to-rgba';
import { theme } from '../common/constants';

interface Props {
  on: boolean;
  onChange?: (value: boolean) => void;
  label?: string;
  // s: 14px, m: 18px
  size?: 's' | 'm';
  className?: string;
}

// a metal rim around the glass
const rim = `0 0 0 2px ${theme.colors.primaryLowContrast}`;

const Root = styled.button`
  position: relative;
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid ${theme.colors.primaryDarkMediumContrast};
  background: radial-gradient(
    circle at 35% 35%,
    ${theme.colors.primaryMediumContrast},
    ${theme.colors.primaryHighContrast}
  );
  box-shadow: ${rim}, inset 0 1px 3px rgb(0 0 0 / 40%);
  cursor: pointer;
  transition: background 150ms, box-shadow 150ms;
  -webkit-tap-highlight-color: transparent;

  &.m {
    width: 18px;
    height: 18px;
  }

  /* the glare */
  &::after {
    content: '';
    position: absolute;
    top: 18%;
    left: 22%;
    width: 30%;
    height: 22%;
    border-radius: 50%;
    background: rgb(255 255 255 / 35%);
    pointer-events: none;
  }

  &:focus {
    outline: none;
  }

  &:focus-visible {
    outline: 1px solid ${theme.colors.secondAccent};
    outline-offset: 3px;
  }

  &.on {
    border-color: ${theme.colors.secondAccent};
    background: radial-gradient(circle at 35% 35%, #eaf6ff, ${theme.colors.secondAccent} 65%);
    box-shadow: ${rim}, 0 0 6px 3px ${hexToRgba(theme.colors.secondAccent, 0.6)},
      0 0 14px 6px ${hexToRgba(theme.colors.secondAccent, 0.3)};

    &::after {
      background: rgb(255 255 255 / 80%);
    }
  }
`;

export const Lamp = ({ on, onChange, label, size = 's', className }: Props) => (
  <Root
    type='button'
    className={cls(className, { on, m: size === 'm' })}
    aria-pressed={on}
    aria-label={label}
    onClick={() => onChange?.(!on)}
  />
);
