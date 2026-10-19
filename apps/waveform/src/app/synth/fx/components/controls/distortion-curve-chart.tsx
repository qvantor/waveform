import React from 'react';
import styled from 'styled-components';
import { Vector2D } from '@waveform/math';
import {
  affine,
  Deactivated,
  HandleModulation,
  Line,
  LineChart,
  linePath,
  LiveKnob,
  liveKnob,
  theme,
  useLineChartContext,
  useLiveDraw,
  useLivePath,
} from '@waveform/ui-kit';
import { distortion } from '../../effects/distortion';
import { CURVE_POINTS, curveInput, transferCurve } from './distortion-curve';

// a little over full scale, so the clipped plateaus don't sit on the edges; the line spans the whole width
// like the other charts, 1px above and below for its stroke
const DOMAIN_X: [number, number] = [0, CURVE_POINTS - 1];
const DOMAIN_Y: [number, number] = [1.1, -1.1];
const CHART_PADDING: Vector2D = [0, 1];
// the straight line of the dry signal
const DRY = Array.from({ length: CURVE_POINTS }, (_, i) => curveInput(i));
// the x of each point of the curve: its index
const INDICES = Float64Array.from({ length: CURVE_POINTS }, (_, i) => i);

const { drive: DRIVE } = distortion.params;

const Root = styled.div`
  position: relative;
  display: flex;
  border-radius: 3px;
`;

const Chart = styled(LineChart)`
  flex: 1 1;
  border-radius: 3px;
`;

// the curve of the mode at Drive, also where its routes move it (every frame, without a render: useLiveDraw)
const Curve = ({ mode, knobs, active }: { mode: number; knobs: LiveKnob[]; active: boolean }) => {
  const { scaleX, scaleY } = useLineChartContext();
  const [path, write] = useLivePath();
  const curve = React.useMemo(() => new Float64Array(CURVE_POINTS), []);
  const scales = React.useMemo(() => ({ x: affine(scaleX), y: affine(scaleY) }), [scaleX, scaleY]);
  const draw = React.useCallback(
    ([drive]: number[]) =>
      write(linePath(CURVE_POINTS, INDICES, transferCurve(mode, drive, curve), scales.x, scales.y)),
    [mode, curve, scales, write]
  );
  useLiveDraw(knobs, draw, active);
  return <path ref={path} style={{ stroke: theme.colors.accent, fill: 'transparent', strokeWidth: 1.5 }} />;
};

interface Props {
  mode: number;
  drive: number;
  active: boolean;
  // the routes of Drive
  modulations?: HandleModulation[];
  className?: string;
}

// the transfer curve: the output over the input (full scale on both axes), the dry signal is the faint
// diagonal; more drive bends it earlier
export const DistortionCurveChart = ({ mode, drive, active, modulations, className }: Props) => {
  const knobs = [liveKnob(drive, DRIVE, modulations)];
  return (
    <Root className={className} data-testid='distortion-curve'>
      {!active && <Deactivated data-testid='distortion-curve-deactivated' />}
      <Chart domainX={DOMAIN_X} domainY={DOMAIN_Y} padding={CHART_PADDING}>
        <Line data={DRY} style={{ stroke: theme.colors.primaryHighContrast, strokeWidth: 1, opacity: 0.5 }} />
        <Curve mode={mode} knobs={knobs} active={active} />
      </Chart>
    </Root>
  );
};
