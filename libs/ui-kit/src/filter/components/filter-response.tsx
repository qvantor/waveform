import React from 'react';
import styled from 'styled-components';
import { Vector2D } from '@waveform/math';
import { Deactivated } from '../../common/styles';
import { LineChart } from '../../line-chart';
import { DB_RANGE, getChartData } from '../services';
import { FilterProps } from '../types';
import { FilterLineChart } from './filter-linechart';

const Root = styled.div`
  position: relative;
  display: flex;
  border-radius: 3px;
`;

const Chart = styled(LineChart)`
  flex: 1 1;
  border-radius: 3px;
`;

// the line runs edge to edge, 1px vertically keeps the stroke from being cut at the top/bottom
const CHART_PADDING: Vector2D = [0, 1];

type Props = Partial<Pick<FilterProps, 'gain'>> &
  Omit<FilterProps, 'gain'> & {
    type: BiquadFilterType;
    sampleRate: number;
    active?: boolean;
    className?: string;
  };

// frequency response chart of a BiquadFilterNode with these params
export const FilterResponse = ({
  type,
  cutoff,
  resonance,
  gain = 0,
  sampleRate,
  active = true,
  className,
}: Props) => {
  const data = React.useMemo(
    () => getChartData(type, { cutoff, resonance, gain }, sampleRate),
    [type, cutoff, resonance, gain, sampleRate]
  );
  return (
    <Root className={className} data-testid='filter-response'>
      {!active && <Deactivated data-testid='filter-response-deactivated' />}
      <Chart domainY={[DB_RANGE, -DB_RANGE]} padding={CHART_PADDING}>
        <FilterLineChart data={data} />
      </Chart>
    </Root>
  );
};
