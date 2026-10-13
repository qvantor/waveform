import React from 'react';
import styled from 'styled-components';
import { Checkbox } from '../checkbox';
import { theme } from '../common/constants';
import { text12, textBold12 } from '../common/styles';

interface Props {
  name?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  // on the right side of the header, its clicks don't reach onClick
  extra?: React.ReactNode;
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

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;

  &:focus,
  &:focus-visible {
    outline: none;
  }
`;

// takes the rest of the header, right-aligned; fills the header height, so a select doesn't make it taller
const Extra = styled.div`
  flex: 1 1;
  min-width: 0;
  display: flex;
  justify-content: flex-end;
  margin: -3px -5px -3px 0;
  cursor: default;
  ${text12};
`;

const Content = styled.div`
  flex: 1 1;
`;

export const Section = ({ name, children, active, onClick, extra }: React.PropsWithChildren<Props>) => {
  return (
    <Root>
      <Header onClick={onClick}>
        {/* the whole header is clickable, the title is the accessible toggle (the extra is not part of it) */}
        <Title
          {...(onClick && {
            role: 'button',
            tabIndex: 0,
            'aria-pressed': active,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onClick();
            },
          })}
        >
          {active !== undefined && <Checkbox checked={active} />}
          {name}
        </Title>
        {extra && <Extra onClick={(e) => e.stopPropagation()}>{extra}</Extra>}
      </Header>
      <Content>{children}</Content>
    </Root>
  );
};
