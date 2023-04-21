import styled, { css } from 'styled-components';
import { PropsWithChildren, ButtonHTMLAttributes } from 'react';
import { theme } from '../common/constants';

const ActiveStyle = css`
  background: ${theme.colors.secondAccent};
  box-shadow: inset 0 0 0 1px #99cbec, 0 0 3px 2px rgba(153, 203, 236, 0.5);
`;
const Root = styled.button<{ active: boolean }>`
  border: 1px solid ${theme.colors.primaryDarkMediumContrast};
  border-radius: 3px;
  padding: 3px;
  display: flex;
  align-items: center;
  color: ${theme.colors.primary};
  cursor: pointer;

  &:active {
    ${ActiveStyle}
  }

  ${({ active }) =>
    active
      ? ActiveStyle
      : css`
          background: ${theme.colors.primaryHighContrast};
        `}
  svg {
    font-size: 15px;
  }
`;

type Props = PropsWithChildren<{ active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>>;

export const IconButton = ({ children, active, ...rest }: Props) => {
  return (
    <Root active={active ?? false} {...rest}>
      {children}
    </Root>
  );
};
