import React from 'react';
import styled from 'styled-components';
import { theme } from '../common/constants';
import { MeterLoop, meterLoop } from '../common/utils/meter-loop';
import { createPeakHold, dbToHeight, FFT_SIZE, levels, toDb, zoneStops } from './meter';

const Root = styled.div`
  position: relative;
  border: 1px solid ${theme.colors.primaryDark};
  background: ${theme.colors.primaryDarkMediumContrast};
  border-radius: 3px;

  canvas {
    border-radius: 2px;
  }
`;

const Separator = styled.div`
  position: absolute;
  width: 1px;
  background: ${theme.colors.primaryDark};
`;

const ZONE_COLORS = { normal: theme.colors.accent, warn: theme.colors.thirdAccent, hot: theme.colors.red };

interface Props {
  master: AudioNode;
  audioCtx: AudioContext;
  width?: number;
  height?: number;
  gap?: number;
  // a voice sounds: drawn every frame; else it sleeps once the output has been silent a while (meterLoop)
  active?: boolean;
}

// the level of each channel in dBFS (meter.ts): the bar is the rms, the mark the held sample peak
export const VolumeAnalyser = ({
  master,
  audioCtx,
  width = 40,
  height = 60,
  gap = 1,
  active = true,
}: Props) => {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const activeRef = React.useRef(active);
  const loopRef = React.useRef<MeterLoop | null>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    const ctx = ref.current.getContext('2d') as CanvasRenderingContext2D;
    // a mono input would reach only the left column: the splitter is discrete and its interpretation
    // can't be changed (Chrome throws), so mono is upmixed to both sides first, as the speakers play it
    const upmix = audioCtx.createGain();
    upmix.channelCount = 2;
    upmix.channelCountMode = 'explicit';
    upmix.channelInterpretation = 'speakers';
    const splitter = audioCtx.createChannelSplitter(2);
    master.connect(upmix);
    upmix.connect(splitter);

    const columnWidth = (width - gap) / 2;
    const columns = [0, 1].map((channel) => {
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      splitter.connect(analyser, channel);
      return {
        analyser,
        data: new Float32Array(FFT_SIZE),
        peakHold: createPeakHold(),
        x: channel * (columnWidth + gap),
        bar: 0,
        mark: 0,
      };
    });

    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    zoneStops().forEach(([offset, zone]) => gradient.addColorStop(offset, ZONE_COLORS[zone]));
    // the canvas has a bar or a mark on it: a frame without any clears it once, then nothing is drawn (no commit)
    let shown = false;

    const draw = (time: number) => {
      let any = false;
      for (const column of columns) {
        column.analyser.getFloatTimeDomainData(column.data);
        const { rms, peak } = levels(column.data);
        column.bar = dbToHeight(toDb(rms), height);
        column.mark = dbToHeight(column.peakHold(toDb(peak), time / 1000), height);
        if (column.bar > 0 || column.mark > 0) any = true;
      }
      if (!any && !shown) return false;
      ctx.clearRect(0, 0, width, height);
      shown = any;
      for (const { bar, mark, x } of columns) {
        ctx.fillStyle = gradient;
        ctx.fillRect(x, height, columnWidth, -bar);
        if (mark <= 0) continue;
        ctx.fillStyle = theme.colors.thirdAccent;
        ctx.fillRect(x, Math.min(Math.round(height - mark), height - 1), columnWidth, 1);
      }
      return any;
    };
    const loop = meterLoop(draw);
    loop.setAwake(activeRef.current);
    loopRef.current = loop;

    return () => {
      loop.stop();
      loopRef.current = null;
      master.disconnect(upmix);
      upmix.disconnect();
      splitter.disconnect();
    };
  }, [height, width, gap, audioCtx, master]);

  React.useEffect(() => {
    activeRef.current = active;
    loopRef.current?.setAwake(active);
  }, [active]);

  return (
    <Root style={{ width, height }}>
      <Separator style={{ height, left: (width - gap) / 2 }} />
      <canvas ref={ref} width={width} height={height} />
    </Root>
  );
};
