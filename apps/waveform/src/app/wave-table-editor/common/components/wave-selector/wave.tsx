import React from 'react';
import styled from 'styled-components';
import { Line, LineChart, theme } from '@waveform/ui-kit';

const Root = styled.div<{ selected: boolean }>`
  width: 59px;
  height: 59px;
  border: 1px solid
    ${({ selected }) => (selected ? theme.colors.accent : theme.colors.primaryDarkHighContrast)};
`;

interface Props {
  wave: number[];
  selected: boolean;
  onClick?: () => void;
}

export const Wave = ({ wave, selected, onClick }: Props) => {
  return (
    <Root selected={selected} onClick={onClick}>
      <LineChart domainX={[0, wave.length - 1]} domainY={[1, -1]} padding={[0, 0]}>
        <Line data={wave} />
      </LineChart>
    </Root>
  );
};
