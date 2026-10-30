import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { HandleModulation, LineChart, LiveKnob, theme, useLiveDraw, useLiveLine } from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import {
  crossfadeFrames,
  morphedFrame,
  playedFrame,
  playedFrames,
} from '../../../common/wavetable/wavetable-frames';
import { useOscillatorContext } from '../../hooks';
import { PhaseOverlay } from './phase-overlay';
import { DrawnWave, periodX, usePeriodLine } from './period';

const PADDING: [number, number] = [-1, 2];
const DOMAIN_Y: [number, number] = [1, -1];
// the wave and its fill (the period line closed along the middle)
const LINE = { stroke: theme.colors.accent, width: 2, fill: 'closed', fillOpacity: 0.3 } as const;

type Table = BehaviorSubject<number[]>[];

// frame e of those played (as $playedWave and the voices): of an expanded table (a morph) the crossfade of two of
// its frames (into `out`)
const playedAt = (table: Table, morph: boolean, e: number, out: { current: Float64Array }) => {
  if (playedFrames(table.length, morph) === table.length) return table[e]?.value ?? [];
  const { frame, share } = morphedFrame(e, table.length);
  const a = table[frame].value;
  if (share === 0) return a;
  const b = table[frame + 1].value;
  const length = Math.min(a.length, b.length);
  if (out.current.length !== length) out.current = new Float64Array(length);
  return crossfadeFrames(a, b, share, out.current);
};

interface LineProps {
  // the wave at the knob ($playedWave), the frames of the table and its morph
  wave: number[];
  table: Table;
  morph: boolean;
  // the Wave knob (the position in frames)
  knobs: LiveKnob[];
  active: boolean;
  // the wave drawn: the phase overlay follows it
  $drawn: BehaviorSubject<DrawnWave | null>;
}

// the wave at the position on a canvas over the chart, also where the routes of the knob move it (the frame worked
// out every frame, without a render: useLiveDraw; drawn again only once the frame played changes)
const WaveLine = ({ wave, table, morph, knobs, active, $drawn }: LineProps) => {
  const [canvas, drawLine] = useLiveLine(LINE, 'wave-line');
  const line = usePeriodLine();
  const crossfade = React.useRef(new Float64Array(0));
  const base = knobs[0].value;
  const draw = React.useMemo(() => {
    // the frame drawn (-1: the wave at the knob): a move of the routes within a frame draws nothing
    let drawnFrame = NaN;
    return ([position]: number[]) => {
      const frames = playedFrames(table.length, morph);
      const frame = position === base ? -1 : playedFrame(frames > 1 ? position / (frames - 1) : 0, frames);
      if (frame === drawnFrame) return;
      drawnFrame = frame;
      const drawn = frame === -1 ? wave : playedAt(table, morph, frame, crossfade);
      const count = line.points(drawn);
      drawLine(count, line.xs, line.ys, line.x, line.y);
      $drawn.next({ wave: drawn, line, count });
    };
  }, [base, wave, table, morph, line, drawLine, $drawn]);
  useLiveDraw(knobs, draw, active);
  return canvas;
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
  const $drawn = React.useMemo(() => new BehaviorSubject<DrawnWave | null>(null), []);
  const knobs = [{ value: position, min: 0, max: Math.max(0, frames - 1), modulations }];
  return (
    <LineChart
      padding={PADDING}
      domainX={[periodX(0, wave.length), periodX(1, wave.length)]}
      domainY={DOMAIN_Y}
      overlay={
        <>
          <WaveLine wave={wave} table={table} morph={morph} knobs={knobs} active={active} $drawn={$drawn} />
          <PhaseOverlay length={wave.length} $drawn={$drawn} visible={phaseVisible} />
        </>
      }
    />
  );
};
