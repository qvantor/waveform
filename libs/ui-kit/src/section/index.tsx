import React from 'react';
import clsx from 'classnames';
import styled from 'styled-components';
import { theme } from '../common/constants';
import { textBold12 } from '../common/styles';

interface Props {
  name?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}

const Root = styled.div`
  padding: 10px;
  display: flex;
  flex-direction: column;
  background: ${theme.colors.primary};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  cursor: pointer;
  gap: 10px;
  ${textBold12};
  padding: 3px 5px;
  background: ${theme.colors.primaryLowContrast};
  color: ${theme.colors.white};
  margin-bottom: 5px;
  border-radius: 3px;
`;

const ActiveIndicator = styled.div`
  width: 12px;
  height: 12px;
  background: ${theme.colors.primaryHighContrast};
  border: 1px solid ${theme.colors.primaryDarkMediumContrast};
  border-radius: 3px;
  box-shadow: none;
  transition: all 150ms;

  &.active {
    background: ${theme.colors.secondAccent};
    box-shadow: inset 0 0 0 1px #99cbec, 0 0 3px 2px rgba(153, 203, 236, 0.5);
  }
`;

const Content = styled.div`
  flex: 1 1;
`;

export const Section = ({ name, children, active, onClick }: React.PropsWithChildren<Props>) => {
  return (
    <Root>
      <Header onClick={onClick}>
        {active !== undefined && <ActiveIndicator className={clsx({ active: active })} />}
        {name}
      </Header>
      <Content>{children}</Content>
    </Root>
  );
};
