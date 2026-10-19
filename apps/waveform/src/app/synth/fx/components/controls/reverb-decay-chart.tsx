import React from 'react';
import styled from 'styled-components';
import { scaleLog } from 'd3-scale';
import { number, Vector2D } from '@waveform/math';
import {
  affine,
  areaPath,
  Deactivated,
  HandleModulation,
  LineChart,
  linePath,
  LiveKnob,
  liveKnob,
  theme,
  useLineChartContext,
  useLiveDraw,
  useLivePath,
} from '@waveform/ui-kit';
import { reverb } from '../../effects/reverb';
import { DECAY_CHART_FREQS, DecayParams, decayCurve } from './reverb-decay-curve';

// RT60 axis (s), log: from a tiny room to a frozen tail
const MIN_SECONDS = 0.05;
const MAX_SECONDS = 80;
const DOMAIN_Y: [number, number] = [Math.log10(MAX_SECONDS), Math.log10(MIN_SECONDS)];
const CHART_PADDING: Vector2D = [0, 1];
const POINTS = DECAY_CHART_FREQS.length;

const { size: SIZE, decay: DECAY, damp: DAMP, bass: BASS } = reverb.params;

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

// the curve at Size, Decay, Hi damp and Bass, also where their routes move them (every frame, without a render:
// useLiveDraw)
const Curve = ({ knobs, sampleRate, active }: { knobs: LiveKnob[]; sampleRate: number; active: boolean }) => {
  const { width, height, padding, scaleY } = useLineChartContext();
  const [line, writeLine] = useLivePath();
  const [fill, writeFill] = useLivePath();
  const [seconds, ys] = React.useMemo(() => [new Float64Array(POINTS), new Float64Array(POINTS)], []);
  // the x of each frequency of the chart, the scale of y and the bottom of the fill
  const layout = React.useMemo(() => {
    const scaleX = scaleLog()
      .domain([DECAY_CHART_FREQS[0], DECAY_CHART_FREQS[POINTS - 1]])
      .range([0, width - padding[0] * 2]);
    const xs = Float64Array.from(DECAY_CHART_FREQS, (freq) => scaleX(freq));
    return { xs, y: affine(scaleY), y0: height - padding[1] * 2 };
  }, [width, height, padding, scaleY]);
  const draw = React.useCallback(
    ([size, decay, damp, bass]: number[]) => {
      const { xs, y, y0 } = layout;
      decayCurve({ size, decay, damp, bass }, sampleRate, seconds);
      for (let i = 0; i < POINTS; i++) ys[i] = y.k * toY(seconds[i]) + y.b;
      const d = linePath(POINTS, xs, ys);
      writeLine(d);
      writeFill(areaPath(d, xs[0], xs[POINTS - 1], y0));
    },
    [sampleRate, seconds, ys, layout, writeLine, writeFill]
  );
  useLiveDraw(knobs, draw, active);
  return (
    <>
      <path ref={fill} style={{ fill: theme.colors.accent, opacity: 0.15 }} />
      <path ref={line} style={{ stroke: theme.colors.accent, strokeWidth: 1, fill: 'transparent' }} />
    </>
  );
};

type Props = DecayParams & {
  sampleRate: number;
  active: boolean;
  // the routes of the knobs of the curve
  modulations?: Partial<Record<keyof DecayParams, HandleModulation[]>>;
  className?: string;
};

// decay time over frequency: Bass lifts the lows,
// the highs above Hi damp fall off
export const ReverbDecayChart = ({
  size,
  decay,
  damp,
  bass,
  sampleRate,
  active,
  modulations,
  className,
}: Props) => {
  const knobs = [
    liveKnob(size, SIZE, modulations?.size),
    liveKnob(decay, DECAY, modulations?.decay),
    liveKnob(damp, DAMP, modulations?.damp),
    liveKnob(bass, BASS, modulations?.bass),
  ];
  return (
    <Root className={className} data-testid='reverb-decay'>
      {!active && <Deactivated data-testid='reverb-decay-deactivated' />}
      <Chart domainY={DOMAIN_Y} padding={CHART_PADDING}>
        <Curve knobs={knobs} sampleRate={sampleRate} active={active} />
      </Chart>
    </Root>
  );
};
