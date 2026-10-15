import React from 'react';
import cls from 'classnames';
import styled, { css } from 'styled-components';
import { text10, theme } from '@waveform/ui-kit';

// the space on both sides of a group and the line on its left
const PADDING = 15;
const LINE = 1;

// every group has the line on its left, ControlsFlow cuts off the line and the padding of the first group
// of each wrapped line; can shrink below its content when a panel is narrower than the group
const Root = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 ${PADDING}px;
  border-left: ${LINE}px solid ${theme.colors.primaryLowContrast};
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
  min-width: 0;
  display: flex;
  align-items: flex-end;
  gap: 10px;
`;

// a chart in a group: narrower on phones (--fx-chart-width), shrinks when the group doesn't fit the panel
export const groupChart = css`
  width: var(--fx-chart-width, 160px);
  min-width: 96px;
  height: 80px;
`;

// the groups of an effect (Out goes with its last one) in one flow, wrapped into lines on narrow screens;
// out of the clip of FxPanel on the left: the line and the padding of the first group of a line, on the
// right: the padding of the last one
export const ControlsFlow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  row-gap: 10px;
  margin: 0 -${PADDING}px 0 -${PADDING + LINE}px;
`;

// the last group of an effect and Out: they wrap to a new line together, so Out is never alone on its line;
// takes the rest of the line (Out is pushed to its right end)
export const LastGroups = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: stretch;
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
