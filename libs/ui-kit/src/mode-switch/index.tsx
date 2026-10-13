import React from 'react';
import cls from 'classnames';
import styled from 'styled-components';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { theme } from '../common/constants';
import { text10, textBold12 } from '../common/styles';

interface Option<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (id: T) => void;
  disabled?: boolean;
  className?: string;
}

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 104px;

  &.disabled {
    pointer-events: none;
    opacity: 0.5;
  }
`;

// a small dark screen, same as the selects
const Display = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 4px 5px;
  border: none;
  border-radius: ${theme.borderRadius.m};
  background: ${theme.colors.primaryDark};
  box-shadow: inset 0 1px 4px rgb(0 0 0 / 60%);
  color: ${theme.colors.white};
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:focus {
    outline: none;
  }

  &:focus-visible {
    outline: 1px solid ${theme.colors.secondAccent};
  }

  .disabled & {
    color: ${theme.colors.primaryHighContrast};
  }
`;

const Icon = styled.div`
  display: flex;
  height: 24px;
  color: ${theme.colors.secondAccent};

  .disabled & {
    color: ${theme.colors.primaryHighContrast};
  }
`;

const Name = styled.span`
  ${textBold12};
  letter-spacing: 0.5px;
  white-space: nowrap;
`;

const Dots = styled.div`
  display: flex;
  gap: 4px;
`;

const Dot = styled.span`
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: ${theme.colors.primaryDarkMediumContrast};

  &.current {
    background: ${theme.colors.secondAccent};
    box-shadow: 0 0 3px 1px rgba(153, 203, 236, 0.5);
  }
`;

const Arrows = styled.div`
  display: flex;
  gap: 4px;
`;

const Arrow = styled.button`
  flex: 1 1;
  display: flex;
  justify-content: center;
  padding: 2px 0;
  border: none;
  border-radius: ${theme.borderRadius.m};
  background: ${theme.colors.primaryDark};
  color: ${theme.colors.white};
  ${text10};
  cursor: pointer;
  transition: all 150ms;

  &:hover {
    background: ${theme.colors.primaryDarkHighContrast};
  }

  &:active {
    background: ${theme.colors.primaryDarkMediumContrast};
  }
`;

// ◀ ▶ through the options with wrap-around, the screen shows the icon and the name of the current one
export const ModeSwitch = <T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  className,
}: Props<T>) => {
  const index = Math.max(
    0,
    options.findIndex((option) => option.id === value)
  );
  const current = options[index];
  const step = (by: number) => onChange(options[(index + by + options.length) % options.length].id);
  return (
    <Root className={cls(className, { disabled })}>
      <Display type='button' disabled={disabled} onClick={() => step(1)} aria-label={current?.label}>
        {current?.icon && <Icon>{current.icon}</Icon>}
        <Name>{current?.label}</Name>
        <Dots>
          {options.map(({ id }, i) => (
            <Dot key={id} className={cls({ current: i === index })} data-testid='mode-switch-dot' />
          ))}
        </Dots>
      </Display>
      <Arrows>
        <Arrow type='button' disabled={disabled} onClick={() => step(-1)} aria-label='Previous'>
          <LeftOutlined />
        </Arrow>
        <Arrow type='button' disabled={disabled} onClick={() => step(1)} aria-label='Next'>
          <RightOutlined />
        </Arrow>
      </Arrows>
    </Root>
  );
};
