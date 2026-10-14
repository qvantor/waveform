import React from 'react';
import cls from 'classnames';
import styled, { css } from 'styled-components';
import hexToRgba from 'hex-to-rgba';
import { theme } from '../common/constants';

interface Props {
  on: boolean;
  onChange?: (value: boolean) => void;
  label?: string;
  // s: 14px, m: 18px
  size?: 's' | 'm';
  // the light, blue by default
  color?: string;
  className?: string;
}

// a metal rim around the glass
const rim = `0 0 0 2px ${theme.colors.primaryLowContrast}`;

// the glass lit from inside: almost white in the middle, the glow around
const lit = (color: string) => css`
  border-color: ${color};
  background: radial-gradient(circle at 35% 35%, ${hexToRgba(color, 0.1)}, ${color} 65%) ${theme.colors.white};
  box-shadow: ${rim}, 0 0 6px 3px ${hexToRgba(color, 0.6)}, 0 0 14px 6px ${hexToRgba(color, 0.3)};
`;

const Root = styled.button<{ $color: string }>`
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
    ${({ $color }) => lit($color)}

    &::after {
      background: rgb(255 255 255 / 80%);
    }
  }
`;

export const Lamp = ({
  on,
  onChange,
  label,
  size = 's',
  color = theme.colors.secondAccent,
  className,
}: Props) => (
  <Root
    type='button'
    className={cls(className, { on, m: size === 'm' })}
    $color={color}
    aria-pressed={on}
    aria-label={label}
    onClick={() => onChange?.(!on)}
  />
);
