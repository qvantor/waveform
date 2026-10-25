import React from 'react';
import styled from 'styled-components';
import { line } from 'd3-shape';
import { Vector2D, vector2d } from '@waveform/math';
import { LineChart, useLineChartContext, Line, XAxis, YAxis } from '../line-chart';
import { Handle } from '../handle';
import { theme } from '../common/constants';
import { text12 } from '../common/styles';
import { curveShape } from './envelope-line';
import { CurvePoint } from './curve-handles';
import { NOTE_DOT_COLOR, NOTE_DOT_RADIUS } from './note-dot';

// the most a MIDI velocity is: the axis shows velocities
const MAX_VELOCITY = 127;
// the points of the curve
const POINTS = 64;

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const Chart = styled(LineChart)`
  flex: 1 1;
  border-radius: 3px;
`;

const Handlers = styled.div`
  display: flex;
  justify-content: flex-start;
`;

const HandleValue = styled.p`
  ${text12};
  text-align: center;
  margin-top: 7px;
`;

// as the dot of a note on the chart of an envelope
const Dot = styled.circle`
  fill: ${NOTE_DOT_COLOR};
  pointer-events: none;
`;

// the curve of the velocity over its share, filled as the line of an envelope
const Curve = ({ k }: { k: number }) => {
  const { scaleX, scaleY } = useLineChartContext();
  const lineFn = line<Vector2D>()
    .x((d) => scaleX(d[0]))
    .y((d) => scaleY(d[1]));
  const data = Array.from({ length: POINTS + 1 }, (_, i) =>
    vector2d.fromValues(i / POINTS, curveShape(k, i / POINTS))
  );
  // closed along the bottom: the fill under the curve
  data.push(vector2d.fromValues(1, 0));
  return (
    <Line
      customLineFn={lineFn}
      data={data}
      style={{ strokeWidth: 1, fill: theme.colors.accent, fillOpacity: 0.1 }}
    />
  );
};

// the dot of a note on the curve of k: its share of the velocity, a child of VelocityCurve
export const VelocityDot = ({ k, velocity }: { k: number; velocity: number }) => {
  const { scaleX, scaleY } = useLineChartContext();
  return (
    <Dot
      data-testid='velocity-dot'
      r={NOTE_DOT_RADIUS}
      cx={scaleX(velocity)}
      cy={scaleY(curveShape(k, velocity))}
    />
  );
};

interface Props {
  // the curve of VELO: k of curveShape over the share of the velocity (0 a line), |k| at most curveMax
  k: number;
  curveMax: number;
  onCurveChange: (k: number) => void;
  // the share of the volume of a note the velocity takes
  amp: number;
  onAmpChange: (amp: number) => void;
  // in the chart, in its context: the VelocityDot of the last note (a note renders it alone, not the chart)
  children?: React.ReactNode;
}

// the velocity of a note: its level (VELO, a source of the modulation) over its share of 127, the point in the
// middle of the curve bends it (a double click: a line), and Amp, the share of the volume of a note it takes
export const VelocityCurve = ({ k, curveMax, onCurveChange, amp, onAmpChange, children }: Props) => (
  <Root>
    <Chart domainX={[0, 1]} domainY={[1, 0]} padding={[10, 5]}>
      <YAxis ticks={2} />
      <XAxis ticks={4} formatText={(share) => Math.round(share * MAX_VELOCITY)} />
      <Curve k={k} />
      {/* under the point of the curve: the dot of a note in the middle doesn't hide it */}
      {children}
      <CurvePoint
        label='Velocity curve'
        from={[0, 0]}
        to={[1, 1]}
        k={k}
        max={curveMax}
        fallback={0}
        onChange={onCurveChange}
      />
    </Chart>
    <Handlers>
      <div>
        <HandleValue>{Math.round(amp * 100)}%</HandleValue>
        <Handle
          label='Amp'
          name='Velo amp'
          min={0}
          max={1}
          precision={100}
          value={amp}
          onChange={onAmpChange}
          formatValue={(value) => `${Math.round(value * 100)}%`}
        />
      </div>
    </Handlers>
  </Root>
);
