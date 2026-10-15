import React from 'react';
import styled from 'styled-components';
import { scaleLog } from 'd3-scale';
import { area, line } from 'd3-shape';
import { number, Vector2D } from '@waveform/math';
import { Deactivated, LineChart, theme, useLineChartContext } from '@waveform/ui-kit';
import { DECAY_CHART_FREQS, DecayParams, decayCurve } from './reverb-decay-curve';

// RT60 axis (s), log: from a tiny room to a frozen tail
const MIN_SECONDS = 0.05;
const MAX_SECONDS = 80;
const DOMAIN_Y: [number, number] = [Math.log10(MAX_SECONDS), Math.log10(MIN_SECONDS)];
const CHART_PADDING: Vector2D = [0, 1];

const Root = styled.div`
  position: relative;
  display: flex;
  border-radius: 3px;
`;

const Chart = styled(LineChart)`
  flex: 1 1;
  border-radius: 3px;
`;

const toY = (seconds: number) => Math.log10(number.thresholds(seconds, MIN_SECONDS, MAX_SECONDS));

const Curve = ({ data }: { data: [number, number][] }) => {
  const { width, height, padding, scaleY } = useLineChartContext();
  const [lineD, areaD] = React.useMemo(() => {
    const scaleX = scaleLog()
      .domain([DECAY_CHART_FREQS[0], DECAY_CHART_FREQS[DECAY_CHART_FREQS.length - 1]])
      .range([0, width - padding[0] * 2]);
    const x = (d: [number, number]) => scaleX(d[0]);
    const y = (d: [number, number]) => scaleY(toY(d[1]));
    return [
      line<[number, number]>().x(x).y(y)(data),
      area<[number, number]>()
        .x(x)
        .y0(height - padding[1] * 2)
        .y1(y)(data),
    ];
  }, [data, width, height, padding, scaleY]);
  return (
    <>
      <path d={areaD ?? undefined} style={{ fill: theme.colors.accent, opacity: 0.15 }} />
      <path
        d={lineD ?? undefined}
        style={{ stroke: theme.colors.accent, strokeWidth: 1, fill: 'transparent' }}
      />
    </>
  );
};

type Props = DecayParams & {
  sampleRate: number;
  active: boolean;
  className?: string;
};

// decay time over frequency: Bass lifts the lows,
// the highs above Hi damp fall off
export const ReverbDecayChart = ({ size, decay, damp, bass, sampleRate, active, className }: Props) => {
  const data = React.useMemo(
    () => decayCurve({ size, decay, damp, bass }, sampleRate),
    [size, decay, damp, bass, sampleRate]
  );
  return (
    <Root className={className} data-testid='reverb-decay'>
      {!active && <Deactivated data-testid='reverb-decay-deactivated' />}
      <Chart domainY={DOMAIN_Y} padding={CHART_PADDING}>
        <Curve data={data} />
      </Chart>
    </Root>
  );
};
