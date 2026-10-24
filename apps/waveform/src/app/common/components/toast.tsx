import styled from 'styled-components';
import { theme } from '@waveform/ui-kit';

// the content of a toast that asks for an answer (react-hot-toast): the text over its keys
export const ToastBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const ToastActions = styled.div`
  display: flex;
  gap: 8px;
`;

export const ToastButton = styled.button`
  border: none;
  border-radius: 3px;
  padding: 4px 10px;
  cursor: pointer;
  color: ${theme.colors.white};
  background: ${theme.colors.primaryDark};

  &.secondary {
    color: ${theme.colors.primaryDark};
    background: ${theme.colors.primary};
  }
`;
