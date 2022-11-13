import React from 'react';
import { CloseOutlined } from '@ant-design/icons';
import styled from 'styled-components';
import { theme } from '../common/constants';

const Root = styled.div`
  position: fixed;
  width: 100vw;
  height: calc(100vh - 80px);
  top: 80px;
  left: 0;
  background: ${theme.colors.primary};
  z-index: 3;
`;

const TopBar = styled.div`
  display: flex;
  gap: 20px;
  color: ${theme.colors.primaryDark};
  align-items: center;
  height: 30px;
  padding: 0 20px;
  background: ${theme.colors.primaryLowContrast};
`;

const CloseButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  width: 22px;
  background: ${theme.colors.primaryDarkHighContrast};
  border-radius: 3px;
  cursor: pointer;
  transition: all 150ms;

  &:hover {
    background: ${theme.colors.primaryDarkMediumContrast};
  }
`;

interface Props {
  name?: React.ReactNode;
  onClose?: () => void;
}

export const Modal = ({ children, name, onClose }: React.PropsWithChildren<Props>) => {
  return (
    <Root>
      <TopBar>
        <CloseButton onClick={onClose}>
          <CloseOutlined style={{ color: theme.colors.white }} />
        </CloseButton>
        {name}
      </TopBar>
      {children}
    </Root>
  );
};
