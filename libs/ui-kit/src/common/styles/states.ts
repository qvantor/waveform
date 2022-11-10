import styled from 'styled-components';
import { theme } from '../constants';

export const Deactivated = styled.div`
  position: absolute;
  width: 100%;
  height: 100%;
  background-image: linear-gradient(
    135deg,
    ${theme.colors.primaryDark} 25%,
    ${theme.colors.primaryDarkMediumContrast} 25%,
    ${theme.colors.primaryDarkMediumContrast} 50%,
    ${theme.colors.primaryDark} 50%,
    ${theme.colors.primaryDark} 75%,
    ${theme.colors.primaryDarkMediumContrast} 75%,
    ${theme.colors.primaryDarkMediumContrast} 100%
  );
  background-size: 10px 10px;
  opacity: 0.8;
  z-index: 1;
  border-radius: 3px;
`;
