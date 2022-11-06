import React from 'react';
import { Handle } from '../../handle';
import type { FilterProps } from '../types';
import { HandlersContainer, LineChartFilter } from '../styles';
import { FilterLineChart } from './filter-linechart';

export const Lowpass = ({ setNumericValue, resonance, cutoff }: FilterProps) => {
  const data: [number, number][] = [
    [10, 0],
    [cutoff - cutoff * 0.01, 0],
    [cutoff, resonance / 12],
    [cutoff + cutoff * 0.1, 0],
    [cutoff * 4, -1],
  ];

  return (
    <>
      <LineChartFilter domainY={[1, -1]}>
        <FilterLineChart data={data} />
      </LineChartFilter>
      <HandlersContainer>
        <Handle
          value={cutoff}
          min={10}
          max={20000}
          precision={1}
          onChange={setNumericValue('cutoff')}
          label='Cutoff'
          mode='log'
          plotSize={200}
        />
        <Handle
          value={resonance}
          min={0}
          max={20}
          precision={10}
          onChange={setNumericValue('resonance')}
          label='Res'
        />
      </HandlersContainer>
    </>
  );
};
