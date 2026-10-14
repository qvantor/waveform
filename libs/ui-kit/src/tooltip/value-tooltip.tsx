import styled from 'styled-components';
import hexToRgba from 'hex-to-rgba';
import { theme } from '../common/constants';
import { textLight14 } from '../common/styles';

// the value of a knob or a fader while it is held
export const ValueTooltipContent = styled.div`
  ${textLight14};
  padding: 3px 8px;
  background: ${hexToRgba(theme.colors.primaryDarkMediumContrast, 0.8)};
  color: ${theme.colors.white};
  border-radius: ${theme.borderRadius.m};
  white-space: nowrap;
`;
