import React from 'react';
import cls from 'classnames';
import styled from 'styled-components';
import { text10, theme } from '@waveform/ui-kit';

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 15px;

  &:first-child {
    padding-left: 0;
  }

  & + & {
    border-left: 1px solid ${theme.colors.primaryLowContrast};
  }
`;

const Caption = styled.div`
  ${text10};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: ${theme.colors.primaryHighContrast};
  transition: color 150ms;

  .disabled > & {
    color: ${theme.colors.primaryLowContrast};
  }
`;

// bottom aligned: the labels of knobs and of the taller faders sit on one line, the charts stand on it
const Content = styled.div`
  flex: 1 1;
  display: flex;
  align-items: flex-end;
  gap: 10px;
`;

interface Props {
  caption: string;
  // bypassed: the caption is dimmed, like the controls
  disabled?: boolean;
  className?: string;
}

// a captioned block of fx controls, neighbouring groups are split by a vertical line
export const ControlsGroup = ({
  caption,
  disabled = false,
  className,
  children,
}: React.PropsWithChildren<Props>) => (
  <Root className={cls(className, { disabled })} role='group' aria-label={caption}>
    <Caption>{caption}</Caption>
    <Content>{children}</Content>
  </Root>
);
