import React from 'react';
import { theme } from '@waveform/ui-kit';
import { useLineChartContext } from '../hooks';

interface Props {
  data: number[];
  style?: React.CSSProperties;
}

export const Line = ({ data, style }: Props) => {
  const { lineFn } = useLineChartContext();
  return (
    <g>
      <path
        style={{ stroke: theme.colors.accent, fill: 'transparent', strokeWidth: 2, ...style }}
        d={lineFn(data) ?? undefined}
      />
    </g>
  );
};
