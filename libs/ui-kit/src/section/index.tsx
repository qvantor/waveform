import React from 'react';
import { Checkbox } from '../checkbox';
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

const Content = styled.div`
  flex: 1 1;
`;

export const Section = ({ name, children, active, onClick }: React.PropsWithChildren<Props>) => {
  return (
    <Root>
      <Header onClick={onClick}>
        {active !== undefined && <Checkbox checked={active} />}
        {name}
      </Header>
      <Content>{children}</Content>
    </Root>
  );
};
