import React from 'react';
import cls from 'classnames';
import styled from 'styled-components';
import { Checkbox } from '../checkbox';
import { theme } from '../common/constants';
import { textBold12 } from '../common/styles';

interface Option<T extends string> {
  id: T;
  label: React.ReactNode;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}

// keys sit in a recessed slot: dark groove around and between them
const Root = styled.div`
  display: flex;
  align-self: stretch;
  gap: 1px;
  padding: 0 1px;
  background: ${theme.colors.primaryMediumContrast};
  box-shadow: inset 0 2px 3px rgb(0 0 0 / 25%);
`;

// lit from above: highlight on the top/left edges, the key's thickness shows as a darker bottom bevel
const raised = `
  inset 0 1px 0 rgb(255 255 255 / 90%),
  inset 1px 0 0 rgb(255 255 255 / 50%),
  inset -1px 0 0 rgb(0 0 0 / 5%),
  inset 0 -4px 0 rgb(0 0 0 / 4%),
  inset 0 -8px 8px -4px rgb(0 0 0 / 10%)
`;

// pushed into the panel: the slot edge throws a shadow on top, the bevel is gone
const sunken = `
  inset 0 6px 8px -4px rgb(0 0 0 / 30%),
  inset 0 1px 2px rgb(0 0 0 / 20%),
  inset 2px 0 4px -2px rgb(0 0 0 / 12%),
  inset -2px 0 4px -2px rgb(0 0 0 / 12%),
  inset 0 -1px 0 rgb(255 255 255 / 60%)
`;

// size is overridable from outside via --tape-key-width / --tape-key-padding
const Key = styled.button`
  width: var(--tape-key-width, 80px);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: var(--tape-key-padding, 12px 0 14px);
  border: none;
  background: ${theme.colors.primary}
    linear-gradient(180deg, rgb(255 255 255 / 45%), rgb(255 255 255 / 0%) 60%);
  box-shadow: ${raised};
  color: ${theme.colors.primaryHighContrast};
  text-shadow: 0 1px 0 rgb(255 255 255 / 80%);
  ${textBold12};
  letter-spacing: 1.5px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: box-shadow 80ms ease-out, background 80ms ease-out, color 150ms;

  & > * {
    transition: transform 80ms ease-out;
  }

  &:hover:not(.pressed) {
    color: ${theme.colors.primaryDarkMediumContrast};
  }

  &:focus,
  &:focus-visible {
    outline: none;
  }

  &.pressed,
  &:active {
    background: ${theme.colors.primary} linear-gradient(180deg, rgb(0 0 0 / 6%), rgb(0 0 0 / 0%) 50%);
    box-shadow: ${sunken};

    & > * {
      transform: translateY(3px);
    }
  }

  &.pressed {
    color: ${theme.colors.primaryDark};
    cursor: default;
  }
`;

export const TapeSwitch = <T extends string>({ options, value, onChange, className }: Props<T>) => (
  <Root className={className}>
    {options.map(({ id, label }) => {
      const pressed = id === value;
      return (
        <Key
          key={id}
          type='button'
          className={cls({ pressed })}
          aria-pressed={pressed}
          onClick={() => onChange(id)}
        >
          <Checkbox checked={pressed} />
          <span>{label}</span>
        </Key>
      );
    })}
  </Root>
);
