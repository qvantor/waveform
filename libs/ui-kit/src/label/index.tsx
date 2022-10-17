import React from 'react';
import { textBold12 } from '../common/styles';
import { theme } from '../common/constants';
import styled from 'styled-components';

const Root = styled.label`
  ${textBold12};
  color: ${theme.colors.primaryDarkMediumContrast};
  display: block;
  text-align: center;
  user-select: none;
`;

export const Label = ({ children }: React.PropsWithChildren) => <Root>{children}</Root>;
