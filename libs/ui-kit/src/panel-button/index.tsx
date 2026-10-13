import React from 'react';
import cls from 'classnames';
import hexToRgba from 'hex-to-rgba';
import styled from 'styled-components';
import { theme } from '../common/constants';
import { textBold12 } from '../common/styles';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  active?: boolean;
  // a small green dot after the label, e.g. "connected"
  indicator?: boolean;
};

// pressed into the panel, a lighter version of the tape key's sunken shadow
const sunken = `
  inset 0 4px 6px -3px rgb(0 0 0 / 20%),
  inset 0 1px 2px rgb(0 0 0 / 12%)
`;

// fills its whole cell, so a row of them reads as one strip of keys
const Root = styled.button`
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  border: none;
  background: ${theme.colors.primary};
  color: ${theme.colors.primaryHighContrast};
  ${textBold12};
  letter-spacing: 1.5px;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 120ms, color 120ms, box-shadow 80ms ease-out;

  svg {
    flex: 0 0 auto;
    font-size: 15px;
  }

  &:hover {
    background: ${theme.colors.white};
    color: ${theme.colors.primaryDarkMediumContrast};
  }

  &:active,
  &.active {
    background: ${theme.colors.primary};
    box-shadow: ${sunken};
  }

  &.active {
    color: ${theme.colors.secondAccent};
  }

  &:disabled {
    cursor: default;
    color: ${theme.colors.primaryLowContrast};
    background: ${theme.colors.primary};
    box-shadow: none;
  }
`;

const Label = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Indicator = styled.span`
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${theme.colors.accent};
  box-shadow: 0 0 4px 1px ${hexToRgba(theme.colors.accent, 0.6)};
`;

export const PanelButton = React.forwardRef<HTMLButtonElement, Props>(
  ({ icon, active = false, indicator = false, className, children, ...rest }, ref) => (
    <Root ref={ref} type='button' className={cls(className, { active })} {...rest}>
      {icon}
      <Label>{children}</Label>
      {indicator && <Indicator data-testid='panel-button-indicator' />}
    </Root>
  )
);
PanelButton.displayName = 'PanelButton';
