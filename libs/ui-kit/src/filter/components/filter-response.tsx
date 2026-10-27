import React from 'react';
import styled from 'styled-components';
import { Vector2D } from '@waveform/math';
import { Deactivated } from '../../common/styles';
import { liveKnob } from '../../common/utils';
import { HandleModulation } from '../../handle';
import { LineChart } from '../../line-chart';
import { DB_RANGE } from '../services';
import { FilterNumerics, FilterProps, FilterRange } from '../types';
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
const DOMAIN_Y: [number, number] = [DB_RANGE, -DB_RANGE];

type Props = Partial<Pick<FilterProps, 'gain'>> &
  Omit<FilterProps, 'gain'> & {
    type: BiquadFilterType;
    sampleRate: number;
    active?: boolean;
    className?: string;
    // the knobs of the params (their travel) and their routes: the chart follows where the routes move them
    ranges?: Partial<Record<FilterNumerics, FilterRange>>;
    modulations?: Partial<Record<FilterNumerics, HandleModulation[]>>;
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
  ranges,
  modulations,
}: Props) => {
  const knobs = [
    liveKnob(cutoff, ranges?.cutoff, modulations?.cutoff),
    liveKnob(resonance, ranges?.resonance, modulations?.resonance),
    liveKnob(gain, ranges?.gain, modulations?.gain),
  ];
  return (
    <Root className={className} data-testid='filter-response'>
      {!active && <Deactivated data-testid='filter-response-deactivated' />}
      <Chart
        domainY={DOMAIN_Y}
        padding={CHART_PADDING}
        overlay={<FilterLineChart type={type} sampleRate={sampleRate} knobs={knobs} active={active} />}
      />
    </Root>
  );
};
