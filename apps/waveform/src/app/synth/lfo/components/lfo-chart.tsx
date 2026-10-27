import React from 'react';
import styled from 'styled-components';
import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';
import { number } from '@waveform/math';
import { Line, LineChart, onFrame, theme, useLineChartContext, useLiveCanvas } from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { LfoId, LFOS } from '@waveform/preset-schema';
import { LfoContext } from '../../common/modules/lfos';
import { ModRoute, ModulationContext } from '../../common/modules/modulation';
import { SynthContext } from '../../common/modules/synth';
import { SynthCoreContext } from '../../common/modules/synth-core';
import { LFO_TABLE_SIZE, lfoTable } from '../../common/lfo/lfo-curve';
import type { LfoParams } from '../../common/modules/lfos';
import { noteLfosOf } from '../../modulation/note-lfos';

// the points of the line of a cycle (every 8th level of its table)
const POINTS = 257;
const STEP = LFO_TABLE_SIZE / (POINTS - 1);
const DOMAIN_X: [number, number] = [0, POINTS - 1];
// levels up, the padding of the radius of the dot
const DOMAIN_Y: [number, number] = [1, 0];
const DOT_RADIUS = 4;

const NO_ROUTES = new BehaviorSubject<ModRoute[]>([]);
const NO_VOICES = new BehaviorSubject(0);

const Chart = styled(LineChart)`
  flex: 1 1;
  min-height: 40px;
  border-radius: 3px;
`;

// the level and the share of the cycle of LFO `id` in the last note while it is heard (a route reads it) and voices
// sound (in free on the clock of the LFO): a white dot in a dark ring on a canvas over the chart, painted again
// every frame it moved, without a render; cleared otherwise (and without the synth: a spec of the section)
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
      const x = number.round(scaleX(lfos.position(index) * (POINTS - 1)), 10);
      const y = number.round(scaleY(level), 10);
      if (x === drawnX && y === drawnY) return;
      drawnX = x;
      drawnY = y;
      const context = begin();
      if (!context) return;
      context.fillStyle = theme.colors.primaryDark;
      context.beginPath();
      context.arc(x, y, DOT_RADIUS + 1, 0, 2 * Math.PI);
      context.fill();
      context.fillStyle = theme.colors.white;
      context.beginPath();
      context.arc(x, y, DOT_RADIUS, 0, 2 * Math.PI);
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

// a cycle of the shape of an LFO (its points of its own when it has them), the dot of the last note on it
export const LfoChart = ({ id, lfo: { shape, points } }: { id: LfoId; lfo: LfoParams }) => {
  const data = React.useMemo(() => {
    const table = lfoTable(shape, points);
    return Array.from({ length: POINTS }, (_, i) => table[i * STEP]);
  }, [shape, points]);
  return (
    <Chart
      domainX={DOMAIN_X}
      domainY={DOMAIN_Y}
      padding={[DOT_RADIUS, DOT_RADIUS]}
      overlay={<NoteDot id={id} />}
      data-testid='lfo-chart'
    >
      <Line data={data} />
    </Chart>
  );
};
