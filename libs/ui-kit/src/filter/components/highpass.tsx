import React from 'react';
import { Handle } from '../../handle';
import { FilterProps } from '../types';
import { HandlersContainer, LineChartFilter } from '../styles';
import { FilterLineChart } from './filter-linechart';

export const Highpass = ({ setNumericValue, resonance, cutoff }: FilterProps) => {
  const data: [number, number][] = [
    [cutoff - cutoff * 0.75, -1],
    [cutoff - cutoff * 0.1, 0],
    [cutoff + cutoff * 0.01, resonance / 15],
    [cutoff, 0],
    [20000, 0],
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
