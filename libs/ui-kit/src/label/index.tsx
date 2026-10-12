import React from 'react';
import styled from 'styled-components';
import { textBold12 } from '../common/styles';
import { theme } from '../common/constants';

const Root = styled.label`
  ${textBold12};
  color: ${theme.colors.primaryDarkMediumContrast};
  display: block;
  text-align: center;
`;

export const Label = ({ children }: React.PropsWithChildren) => <Root>{children}</Root>;
