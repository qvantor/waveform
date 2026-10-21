import React from 'react';
import styled from 'styled-components';
import hexToRgba from 'hex-to-rgba';
import { theme } from '../common/constants';
import { text12, textLight14 } from '../common/styles';
import { NARROW_ATTR } from './index';

// the value of a knob or a fader while it is held
export const ValueTooltipContent = styled.div`
  ${textLight14};
  padding: 3px 8px;
  background: ${hexToRgba(theme.colors.primaryDarkMediumContrast, 0.8)};
  color: ${theme.colors.white};
  border-radius: ${theme.borderRadius.m};
  white-space: nowrap;

  [${NARROW_ATTR}] & {
    text-align: center;
  }
`;

const Name = styled.span`
  margin-right: 6px;
  color: ${theme.colors.primaryLowContrast};

  /* a knob at the edge of the viewport: over the value, smaller */
  [${NARROW_ATTR}] & {
    ${text12};
    display: block;
    margin-right: 0;
  }
`;

// the full name of what the knob changes before its value, on one line; over it when the line doesn't fit the
// viewport
export const ValueTooltip = ({ name, children }: React.PropsWithChildren<{ name?: string }>) => (
  <ValueTooltipContent>
    {name && <Name>{name}</Name>}
    {children}
  </ValueTooltipContent>
);
