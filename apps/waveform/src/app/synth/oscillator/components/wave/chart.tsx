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
import {
  crossfadeFrames,
  morphedFrame,
  playedFrame,
  playedFrames,
} from '../../../common/wavetable/wavetable-frames';
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

// the wave at a position (of the frames played, fractional), as $playedWave and the voices: one frame of those
// played, of an expanded table (a morph) the crossfade of two of its frames (into `out`)
const playedAt = (table: Table, morph: boolean, position: number, out: { current: Float64Array }) => {
  const frames = playedFrames(table.length, morph);
  const e = playedFrame(frames > 1 ? position / (frames - 1) : 0, frames);
  if (frames === table.length) return table[e]?.value ?? [];
  const { frame, share } = morphedFrame(e, table.length);
  const a = table[frame].value;
  if (share === 0) return a;
  const b = table[frame + 1].value;
  const length = Math.min(a.length, b.length);
  if (out.current.length !== length) out.current = new Float64Array(length);
  return crossfadeFrames(a, b, share, out.current);
};

interface LineProps {
  id: string;
  // the wave at the knob ($playedWave), the frames of the table and its morph
  wave: number[];
  table: Table;
  morph: boolean;
  // the Wave knob (the position in frames)
  knobs: LiveKnob[];
  active: boolean;
  // the wave drawn: the phase dot follows it
  $drawn: BehaviorSubject<ArrayLike<number>>;
}

// the wave at the position, also where the routes of the knob move it (the frame worked out every frame, without
// a render: useLiveDraw)
const WaveLine = ({ id, wave, table, morph, knobs, active, $drawn }: LineProps) => {
  const {
    width,
    padding: [paddingX],
    scaleX,
    scaleY,
  } = useLineChartContext();
  const [path, write] = useLivePath();
  const crossfade = React.useRef(new Float64Array(0));
  const columns = Math.max(1, Math.round(width - paddingX * 2));
  const points = React.useMemo(() => {
    const capacity = periodCapacity(columns);
    return { xs: new Float64Array(capacity), ys: new Float64Array(capacity) };
  }, [columns]);
  const scales = React.useMemo(() => ({ x: affine(scaleX), y: affine(scaleY) }), [scaleX, scaleY]);
  const base = knobs[0].value;
  const draw = React.useCallback(
    ([position]: number[]) => {
      const drawn = position === base ? wave : playedAt(table, morph, position, crossfade);
      const { xs, ys } = points;
      write(linePath(periodPoints(drawn, columns, xs, ys), xs, ys, scales.x, scales.y));
      $drawn.next(drawn);
    },
    [base, wave, table, morph, columns, points, scales, write, $drawn]
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

// the wave the position plays (one frame of those played); while the routes of the Wave knob sound, the
// wave where they move it
export const Chart = ({ phaseVisible = false, modulations }: Props) => {
  const [{ $playedWave, $waveTable, $morph, $position, $active }] = useOscillatorContext();
  const wave = useObservable($playedWave, []);
  const table = useBehaviorSubject($waveTable);
  const morph = useBehaviorSubject($morph);
  const frames = playedFrames(table.length, morph);
  const position = useBehaviorSubject($position);
  const active = useBehaviorSubject($active);
  const lineId = `wave-line-${React.useId().replace(/:/g, '')}`;
  const $drawn = React.useMemo(() => new BehaviorSubject<ArrayLike<number>>([]), []);
  const knobs = [{ value: position, min: 0, max: Math.max(0, frames - 1), modulations }];
  return (
    <Root padding={[-1, 2]} domainX={[periodX(0, wave.length), periodX(1, wave.length)]} domainY={[1, -1]}>
      <WaveLine
        id={lineId}
        wave={wave}
        table={table}
        morph={morph}
        knobs={knobs}
        active={active}
        $drawn={$drawn}
      />
      <PhaseOverlay lineId={lineId} length={wave.length} $drawn={$drawn} visible={phaseVisible} />
    </Root>
  );
};
