import styled from 'styled-components';
import { PropsWithChildren, ButtonHTMLAttributes } from 'react';
import { theme } from '../common/constants';

const Root = styled.button`
  border: 1px solid ${theme.colors.primaryDarkMediumContrast};
  border-radius: 3px;
  padding: 3px;
  display: flex;
  align-items: center;
  background: ${theme.colors.primaryHighContrast};
  color: ${theme.colors.primary};
  cursor: pointer;

  &:active {
    background: ${theme.colors.secondAccent};
    box-shadow: inset 0 0 0 1px #99cbec, 0 0 3px 2px rgba(153, 203, 236, 0.5);
  }

  svg {
    font-size: 15px;
  }
`;

type Props = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>;

export const IconButton = ({ children, ...rest }: Props) => {
  return <Root {...rest}>{children}</Root>;
};
