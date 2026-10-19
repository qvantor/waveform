import React from 'react';
import styled from 'styled-components';
import { BehaviorSubject } from 'rxjs';
import {
  affine,
  HandleModulation,
  LineChart,
  linePath,
  LiveKnob,
  theme,
  useLineChartContext,
  useLiveDraw,
  useLivePath,
} from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../hooks';
import { PhaseOverlay } from './phase-overlay';
import { periodCapacity, periodPoints, periodX } from './period';

// the top of the block of the wave, its values under it
const Root = styled(LineChart)`
  border-radius: 3px 3px 0 0;
`;

// the style of the wave on its group: the line of the phase band (a <use> of its path) takes its own
const LINE_STYLE: React.CSSProperties = {
  stroke: theme.colors.accent,
  strokeWidth: 2,
  fill: theme.colors.accent,
  fillOpacity: 0.3,
};

type Table = BehaviorSubject<number[]>[];

// the wave at a position of the table (frames, fractional), as $morphWave and the voices: frame k and k + 1
// morphed (into `out`, sized to the frame), frame k alone between frames of different lengths
const morphAt = (table: Table, position: number, out: { current: Float64Array }) => {
  const k = Math.max(0, Math.min(Math.floor(position), table.length - 1));
  const share = position - k;
  const a = table[k]?.value ?? [];
  const b = table[k + 1]?.value;
  if (!b || share <= 0 || a.length !== b.length) return a;
  if (out.current.length !== a.length) out.current = new Float64Array(a.length);
  const morph = out.current;
  for (let i = 0; i < a.length; i++) morph[i] = a[i] + (b[i] - a[i]) * share;
  return morph;
};

interface LineProps {
  id: string;
  // the wave at the knob ($morphWave) and the frames
  wave: number[];
  table: Table;
  // the Wave knob (the position in frames)
  knobs: LiveKnob[];
  active: boolean;
  // the wave drawn: the phase dot follows it
  $drawn: BehaviorSubject<ArrayLike<number>>;
}

// the wave at the position, also where the routes of the knob move it (the frames morphed every frame, without a
// render: useLiveDraw)
const WaveLine = ({ id, wave, table, knobs, active, $drawn }: LineProps) => {
  const {
    width,
    padding: [paddingX],
    scaleX,
    scaleY,
  } = useLineChartContext();
  const [path, write] = useLivePath();
  const morph = React.useRef(new Float64Array(0));
  const columns = Math.max(1, Math.round(width - paddingX * 2));
  const points = React.useMemo(() => {
    const capacity = periodCapacity(columns);
    return { xs: new Float64Array(capacity), ys: new Float64Array(capacity) };
  }, [columns]);
  const scales = React.useMemo(() => ({ x: affine(scaleX), y: affine(scaleY) }), [scaleX, scaleY]);
  const base = knobs[0].value;
  const draw = React.useCallback(
    ([position]: number[]) => {
      const drawn = position === base ? wave : morphAt(table, position, morph);
      const { xs, ys } = points;
      write(linePath(periodPoints(drawn, columns, xs, ys), xs, ys, scales.x, scales.y));
      $drawn.next(drawn);
    },
    [base, wave, table, columns, points, scales, write, $drawn]
  );
  useLiveDraw(knobs, draw, active);
  return (
    <g style={LINE_STYLE}>
      <path id={id} ref={path} />
    </g>
  );
};

interface Props {
  // Phase or Phase rand is dragged: show them over the wave
  phaseVisible?: boolean;
  // the routes of the Wave knob
  modulations?: HandleModulation[];
}

// the wave the position plays: between two frames their morph; while the routes of the Wave knob sound, the
// wave where they move it
export const Chart = ({ phaseVisible = false, modulations }: Props) => {
  const [{ $morphWave, $waveTable, $position, $active }] = useOscillatorContext();
  const wave = useObservable($morphWave, []);
  const table = useBehaviorSubject($waveTable);
  const position = useBehaviorSubject($position);
  const active = useBehaviorSubject($active);
  const lineId = `wave-line-${React.useId().replace(/:/g, '')}`;
  const $drawn = React.useMemo(() => new BehaviorSubject<ArrayLike<number>>([]), []);
  const knobs = [{ value: position, min: 0, max: Math.max(0, table.length - 1), modulations }];
  return (
    <Root padding={[-1, 2]} domainX={[periodX(0, wave.length), periodX(1, wave.length)]} domainY={[1, -1]}>
      <WaveLine id={lineId} wave={wave} table={table} knobs={knobs} active={active} $drawn={$drawn} />
      <PhaseOverlay lineId={lineId} length={wave.length} $drawn={$drawn} visible={phaseVisible} />
    </Root>
  );
};
