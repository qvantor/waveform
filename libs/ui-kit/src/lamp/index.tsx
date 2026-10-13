import React from 'react';
import cls from 'classnames';
import styled from 'styled-components';
import { theme } from '../common/constants';

interface Props {
  on: boolean;
  onChange?: (value: boolean) => void;
  label?: string;
  className?: string;
}

const Root = styled.button`
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
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 30%);
  cursor: pointer;
  transition: all 150ms;
  -webkit-tap-highlight-color: transparent;

  &:focus {
    outline: none;
  }

  &:focus-visible {
    outline: 1px solid ${theme.colors.secondAccent};
    outline-offset: 2px;
  }

  &.on {
    background: radial-gradient(circle at 35% 35%, #d6ecfa, ${theme.colors.secondAccent} 60%);
    box-shadow: 0 0 4px 2px rgba(153, 203, 236, 0.7);
  }
`;

export const Lamp = ({ on, onChange, label, className }: Props) => (
  <Root
    type='button'
    className={cls(className, { on })}
    aria-pressed={on}
    aria-label={label}
    onClick={() => onChange?.(!on)}
  />
);
