import React from 'react';
import { Handle } from '../../handle';
import { FilterProps } from '../types';
import { HandlersContainer, LineChartFilter } from '../styles';
import { FilterLineChart } from './filter-linechart';

export const Bandpass = ({ setNumericValue, resonance, cutoff }: FilterProps) => {
  const data: [number, number][] = [
    [(cutoff * resonance) / 1000, -1],
    [(cutoff * resonance) / 1000, -1],
    [cutoff, 1],
    [cutoff / (resonance / 1000), -1],
    [cutoff / (resonance / 1000), -1],
    [20000, -1],
  ];
  if (data[0][0] > 10) data.unshift([10, -1]);

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
          min={0.01}
          max={1000}
          precision={100}
          onChange={setNumericValue('resonance')}
          label='Res'
          mode='log'
        />
      </HandlersContainer>
    </>
  );
};
