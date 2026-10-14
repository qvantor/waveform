import React from 'react';
import { scaleLog } from 'd3-scale';
import styled from 'styled-components';
import { number, requestIdleCallback, cancelIdleCallback } from '@waveform/math';
import { theme } from '../common/constants';

interface Props {
  master: AudioNode;
  audioCtx: AudioContext;
  fftSize?: number;
  className?: string;
}

const Canvas = styled.canvas`
  position: absolute;
`;

const Axis = styled.div`
  position: relative;
`;

const Tick = styled.div`
  position: absolute;
  width: 1px;
  background: ${theme.colors.primaryLowContrast};
  font-size: 8px;
  color: ${theme.colors.primaryDark};
`;

const MIN_FQ = 20;
const TICKS = [100, 1000, 10000];
// a full scale sine reads about -13.5 dB (blackman window), so only partials near 0 dBFS reach the top
// (the default top, -30 dB, is a sine at about -16 dBFS); the bottom stays at the default -100 dB
const MAX_DB = -10;

const formatFq = (fq: number) => (fq >= 1000 ? `${fq / 1000}k` : `${fq}`);

export const FqAnalyser = ({ fftSize = 12, master, audioCtx, className }: Props) => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [[width, height], setSize] = React.useState<[number, number]>([300, 150]);
  const scale = React.useMemo(
    () =>
      scaleLog()
        .domain([MIN_FQ, audioCtx.sampleRate / 2])
        .range([0, width]),
    [width, audioCtx]
  );
  const freqLines = TICKS.map((fq) => ({ x: scale(fq), fq }));

  React.useEffect(() => {
    const onResize = () => {
      if (!rootRef.current) return;
      setSize([rootRef.current.clientWidth, Math.floor(rootRef.current.clientHeight)]);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  React.useEffect(() => {
    if (!ref.current) return;
    let idleCallback = requestIdleCallback(draw);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = number.powerOfTwo(fftSize);
    analyser.maxDecibels = MAX_DB;
    master.connect(analyser);

    const ctx = ref.current.getContext('2d') as CanvasRenderingContext2D;
    const bufferLength = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(bufferLength);
    const freqPerItem = audioCtx.sampleRate / 2 / bufferLength;

    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, theme.colors.accent);
    gradient.addColorStop(1, theme.colors.secondAccent);

    // [bin index, x, width]; bins below MIN_FQ are not drawn
    const grid: [number, number, number][] = [];
    for (let i = 0; i < bufferLength; i++) {
      if ((i + 1) * freqPerItem <= MIN_FQ) continue;
      const start = scale(Math.max(i * freqPerItem, MIN_FQ));
      grid.push([i, start, scale((i + 1) * freqPerItem) - start]);
    }

    function draw() {
      idleCallback = requestIdleCallback(draw);
      analyser.getByteFrequencyData(frequencyData);
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = gradient;
      for (const [i, x, w] of grid) {
        ctx.fillRect(x, height, w, (-frequencyData[i] / 255) * height);
      }
    }

    return () => {
      cancelIdleCallback(idleCallback);
      master.disconnect(analyser);
    };
  }, [width, height, fftSize, audioCtx, master, scale]);

  return (
    <div className={className} ref={rootRef}>
      <Canvas ref={ref} height={height} width={width} />
      <Axis>
        {freqLines.map(({ x, fq }) => (
          <Tick key={x} style={{ left: x, height }}>
            <span>{formatFq(fq)}</span>
          </Tick>
        ))}
      </Axis>
    </div>
  );
};
