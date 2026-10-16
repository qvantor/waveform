import React from 'react';
import styled from 'styled-components';
import { Vector2D } from '@waveform/math';
import { Deactivated, Line, LineChart, theme } from '@waveform/ui-kit';
import { CURVE_POINTS, curveInput, transferCurve } from './distortion-curve';

// a little over full scale, so the clipped plateaus don't sit on the edges; the line spans the whole width
// like the other charts, 1px above and below for its stroke
const DOMAIN_X: [number, number] = [0, CURVE_POINTS - 1];
const DOMAIN_Y: [number, number] = [1.1, -1.1];
const CHART_PADDING: Vector2D = [0, 1];
// the straight line of the dry signal
const DRY = Array.from({ length: CURVE_POINTS }, (_, i) => curveInput(i));

const Root = styled.div`
  position: relative;
  display: flex;
  border-radius: 3px;
`;

const Chart = styled(LineChart)`
  flex: 1 1;
  border-radius: 3px;
`;

interface Props {
  mode: number;
  drive: number;
  active: boolean;
  className?: string;
}

// the transfer curve: the output over the input (full scale on both axes), the dry signal is the faint
// diagonal; more drive bends it earlier
export const DistortionCurveChart = ({ mode, drive, active, className }: Props) => {
  const curve = React.useMemo(() => transferCurve(mode, drive), [mode, drive]);
  return (
    <Root className={className} data-testid='distortion-curve'>
      {!active && <Deactivated data-testid='distortion-curve-deactivated' />}
      <Chart domainX={DOMAIN_X} domainY={DOMAIN_Y} padding={CHART_PADDING}>
        <Line data={DRY} style={{ stroke: theme.colors.primaryHighContrast, strokeWidth: 1, opacity: 0.5 }} />
        <Line data={curve} style={{ strokeWidth: 1.5 }} />
      </Chart>
    </Root>
  );
};
