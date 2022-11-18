import React from 'react';
import { scaleLog } from 'd3-scale';
import styled from 'styled-components';
import { number } from '@waveform/math';
import { theme } from '../common/constants';
import { requestIdleCallback, cancelIdleCallback } from '@waveform/math';

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

export const FqAnalyser = ({ fftSize = 12, master, audioCtx, className }: Props) => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [[width, height], setSize] = React.useState<[number, number]>([300, 150]);
  const scale = React.useMemo(
    () =>
      scaleLog()
        .domain([1, audioCtx.sampleRate / 2])
        .range([0, width]),
    [width, audioCtx]
  );
  const freqLines = [10, 20, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 15000].map((fq) => ({
    x: scale(fq),
    fq,
  }));

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
    master.connect(analyser);

    const ctx = ref.current.getContext('2d') as CanvasRenderingContext2D;
    const bufferLength = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(bufferLength);
    const freqPerItem = audioCtx.sampleRate / 2 / bufferLength;

    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, theme.colors.accent);
    gradient.addColorStop(1, theme.colors.secondAccent);

    let prevColumn = 0;
    const grid: [number, number][] = [];
    for (let i = 0; i < bufferLength; i++) {
      const column = scale(Math.round((i + 1) * freqPerItem));
      grid.push([prevColumn, column - prevColumn]);

      prevColumn = column;
    }

    function draw() {
      idleCallback = requestIdleCallback(draw);
      analyser.getByteFrequencyData(frequencyData);
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < bufferLength; i++) {
        ctx.fillStyle = gradient;
        ctx.fillRect(grid[i][0], height, grid[i][1], (-frequencyData[i] / 255) * height);
      }
    }

    return () => {
      cancelIdleCallback(idleCallback);
    };
  }, [width, height, fftSize, audioCtx, master, scale]);

  return (
    <div className={className} ref={rootRef}>
      <Canvas ref={ref} height={height} width={width} />
      <Axis>
        {freqLines.map(({ x, fq }) => (
          <Tick key={x} style={{ left: x, height }}>
            <span>{fq}</span>
          </Tick>
        ))}
      </Axis>
    </div>
  );
};
