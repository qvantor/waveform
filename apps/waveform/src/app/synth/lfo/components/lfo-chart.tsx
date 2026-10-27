import React from 'react';
import styled from 'styled-components';
import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';
import { number } from '@waveform/math';
import {
  Line,
  LineChart,
  NOTE_DOT_COLOR,
  NOTE_DOT_RADIUS,
  onFrame,
  POINT_RADIUS,
  useLineChartContext,
  useLiveCanvas,
  XAxis,
  YAxis,
} from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { LfoId, LFOS, LfoPoint } from '@waveform/preset-schema';
import { LfoContext } from '../../common/modules/lfos';
import { ModRoute, ModulationContext } from '../../common/modules/modulation';
import { SynthContext } from '../../common/modules/synth';
import { SynthCoreContext } from '../../common/modules/synth-core';
import { lfoTable } from '../../common/lfo/lfo-curve';
import type { LfoParams } from '../../common/modules/lfos';
import { noteLfosOf } from '../../modulation/note-lfos';
import { shapePoints } from '../lfo-shapes';
import { LfoPoints } from './lfo-points';

// the points of the line of a cycle (every 8th level of its table)
const POINTS = 257;
// the share of the cycle
const DOMAIN_X: [number, number] = [0, 1];
// levels up
const DOMAIN_Y: [number, number] = [1, 0];
// the line from edge to edge (the cycle goes on past them), the levels 0 and 1 a point of the editor in (its
// radius in whole px; the dot of a note is smaller)
const PADDING: [number, number] = [0, Math.ceil(POINT_RADIUS)];

const NO_ROUTES = new BehaviorSubject<ModRoute[]>([]);
const NO_VOICES = new BehaviorSubject(0);

const Chart = styled(LineChart)`
  flex: 1 1;
  min-height: 40px;
  border-radius: 3px;
`;

// the lines of the chart, as the envelopes have them: the levels 0, ½ and 1, the quarters of the cycle
const Grid = () => {
  const { scaleX } = useLineChartContext();
  const quarters = React.useMemo(() => scaleX.copy().domain([0, 4]), [scaleX]);
  return (
    <>
      <YAxis ticks={2} />
      <XAxis ticks={4} customScaleX={quarters} />
    </>
  );
};

// the level and the share of the cycle of LFO `id` in the last note while it is heard (a route reads it) and voices
// sound (in free on the clock of the LFO): the dot of a note on the chart of an envelope, on a canvas over the
// chart, painted again every frame it moved, without a render; cleared otherwise (and without the synth: a spec of
// the section)
const NoteDot = ({ id }: { id: LfoId }) => {
  const { scaleX, scaleY } = useLineChartContext();
  const [canvas, begin] = useLiveCanvas('lfo-dot');
  const lfo = React.useContext(LfoContext);
  const synth = React.useContext(SynthContext);
  const modulation = React.useContext(ModulationContext);
  const core = React.useContext(SynthCoreContext);
  const routes = useBehaviorSubject(modulation?.[0].$routes ?? NO_ROUTES);
  const heard = routes.some(({ source }) => source === id);
  const $voices = synth?.[0].$voicesCount ?? NO_VOICES;
  const $sounds = React.useMemo(
    () =>
      $voices.pipe(
        map((count) => count > 0),
        distinctUntilChanged()
      ),
    [$voices]
  );
  const sounds = useObservable($sounds, $voices.value > 0);
  React.useEffect(() => {
    if (!heard || !sounds || !lfo || !synth || !modulation || !core) return;
    const [{ audioCtx }] = core;
    const lfos = noteLfosOf(audioCtx.sampleRate, lfo, synth, modulation);
    const index = LFOS.indexOf(id);
    let [drawnX, drawnY] = [NaN, NaN];
    const draw = () => {
      const level = lfos.level(index, audioCtx.currentTime * audioCtx.sampleRate);
      // to 0.1 px: the dot is painted again only when it moved that much
      const x = number.round(scaleX(lfos.position(index)), 10);
      const y = number.round(scaleY(level), 10);
      if (x === drawnX && y === drawnY) return;
      drawnX = x;
      drawnY = y;
      const context = begin();
      if (!context) return;
      context.fillStyle = NOTE_DOT_COLOR;
      context.beginPath();
      context.arc(x, y, NOTE_DOT_RADIUS, 0, 2 * Math.PI);
      context.fill();
    };
    draw();
    const stop = onFrame(draw);
    return () => {
      stop();
      begin();
    };
  }, [id, heard, sounds, lfo, synth, modulation, core, scaleX, scaleY, begin]);
  return canvas;
};

interface Props {
  id: LfoId;
  lfo: LfoParams;
  // the points edited on the chart (a shape of the LFO as points from its first change on)
  onPointsChange: (points: LfoPoint[]) => void;
}

// a cycle of the shape of an LFO with its points on it (those of its own, or the shape as points: LfoPoints
// drags, curves, adds and takes them out), the dot of the last note on it
export const LfoChart = ({ id, lfo: { shape, points }, onPointsChange }: Props) => {
  const data = React.useMemo(
    () =>
      Array.from(lfoTable(shape, points, POINTS - 1), (level, i): [number, number] => [
        i / (POINTS - 1),
        level,
      ]),
    [shape, points]
  );
  return (
    <Chart
      domainX={DOMAIN_X}
      domainY={DOMAIN_Y}
      padding={PADDING}
      overlay={<NoteDot id={id} />}
      data-testid='lfo-chart'
    >
      <Grid />
      {/* as thin as the line of an envelope */}
      <Line data={data} style={{ strokeWidth: 1 }} />
      <LfoPoints points={points ?? shapePoints(shape)} line={data} onChange={onPointsChange} />
    </Chart>
  );
};
