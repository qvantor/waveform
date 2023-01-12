import React from 'react';
import styled, { css } from 'styled-components';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { theme } from '../common/constants';

const SelectContainer = styled.div`
  display: flex;
  align-items: center;
  background: ${theme.colors.primaryDark};
  border-radius: 3px;
  cursor: pointer;
  gap: 7px;
  width: 100%;
`;

export const ContentContainer = css`
  flex: 1 1;
  background: transparent;
  color: ${theme.colors.white};
  appearance: none;
  border: none;
  padding: 3px 6px;
  font-size: 13.5px;

  &:focus {
    outline: none;
  }
`;

const ArrowIcons = styled.div`
  display: flex;
  margin: -3px -6px;
  padding-left: 6px;

  button {
    cursor: pointer;
    color: ${theme.colors.white};
    padding: 3px;
    border-radius: 3px;
    border: none;
    background: ${theme.colors.primaryDark};
    transition: all 150ms;

    &:hover {
      background: ${theme.colors.primaryDarkHighContrast};
    }

    &:active {
      background: ${theme.colors.primaryDarkMediumContrast};
    }
  }
`;

interface Props {
  prev: () => void;
  next: () => void;
  className?: string;
}

export const SelectDumb = ({ prev, next, children, className }: React.PropsWithChildren<Props>) => {
  return (
    <SelectContainer className={className}>
      <ArrowIcons>
        <button onClick={prev}>
          <LeftOutlined />
        </button>
        <button onClick={next}>
          <RightOutlined />
        </button>
      </ArrowIcons>
      {children}
    </SelectContainer>
  );
};
