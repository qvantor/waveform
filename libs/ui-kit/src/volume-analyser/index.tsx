import React from 'react';
import styled from 'styled-components';
import { theme } from '../common/constants';
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
}

// the level of each channel in dBFS (meter.ts): the bar is the rms, the mark the held sample peak
export const VolumeAnalyser = ({ master, audioCtx, width = 40, height = 60, gap = 1 }: Props) => {
  const ref = React.useRef<HTMLCanvasElement>(null);

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
      };
    });

    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    zoneStops().forEach(([offset, zone]) => gradient.addColorStop(offset, ZONE_COLORS[zone]));

    let frame = requestAnimationFrame(draw);

    function draw(time: number) {
      frame = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, width, height);
      for (const { analyser, data, peakHold, x } of columns) {
        analyser.getFloatTimeDomainData(data);
        const { rms, peak } = levels(data);
        ctx.fillStyle = gradient;
        ctx.fillRect(x, height, columnWidth, -dbToHeight(toDb(rms), height));

        const mark = dbToHeight(peakHold(toDb(peak), time / 1000), height);
        if (mark <= 0) continue;
        ctx.fillStyle = theme.colors.thirdAccent;
        ctx.fillRect(x, Math.min(Math.round(height - mark), height - 1), columnWidth, 1);
      }
    }

    return () => {
      cancelAnimationFrame(frame);
      master.disconnect(upmix);
      upmix.disconnect();
      splitter.disconnect();
    };
  }, [height, width, gap, audioCtx, master]);

  return (
    <Root style={{ width, height }}>
      <Separator style={{ height, left: (width - gap) / 2 }} />
      <canvas ref={ref} width={width} height={height} />
    </Root>
  );
};
