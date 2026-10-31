import React from 'react';
import { scaleLog } from 'd3-scale';
import styled from 'styled-components';
import { number } from '@waveform/math';
import { theme } from '../common/constants';
import { MeterLoop, meterLoop } from '../common/utils/meter-loop';

interface Props {
  master: AudioNode;
  audioCtx: AudioContext;
  fftSize?: number;
  className?: string;
  // a voice sounds: drawn every frame; else it sleeps once the output has been silent a while (meterLoop)
  active?: boolean;
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

export const FqAnalyser = ({ fftSize = 12, master, audioCtx, className, active = true }: Props) => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const ref = React.useRef<HTMLCanvasElement>(null);
  const activeRef = React.useRef(active);
  const loopRef = React.useRef<MeterLoop | null>(null);
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

    // [first bin, end bin, x, width]: a column of a bin a pixel wide or more, or of the next bins narrower than a
    // pixel together (the high ones: 2047 bars of 4096 bins are ~400 columns at 800 px), as tall as the tallest
    // of them (their bars drawn one over the other showed as much); the bins below MIN_FQ are not drawn
    const columns: [number, number, number, number][] = [];
    let from = -1;
    let start = 0;
    for (let i = 0; i < bufferLength; i++) {
      if ((i + 1) * freqPerItem <= MIN_FQ) continue;
      if (from < 0) {
        from = i;
        start = scale(Math.max(i * freqPerItem, MIN_FQ));
      }
      const end = scale((i + 1) * freqPerItem);
      if (end - start < 1 && i < bufferLength - 1) continue;
      columns.push([from, i + 1, start, end - start]);
      from = -1;
    }
    const tops = new Uint8Array(columns.length);
    // the canvas has bars on it: a frame without any clears it once, then nothing is drawn (no commit)
    let shown = false;

    const draw = () => {
      analyser.getByteFrequencyData(frequencyData);
      let any = false;
      for (let c = 0; c < columns.length; c++) {
        const [first, end] = columns[c];
        let top = 0;
        for (let i = first; i < end; i++) if (frequencyData[i] > top) top = frequencyData[i];
        tops[c] = top;
        if (top > 0) any = true;
      }
      if (!any && !shown) return false;
      ctx.clearRect(0, 0, width, height);
      shown = any;
      if (!any) return false;
      ctx.fillStyle = gradient;
      for (let c = 0; c < columns.length; c++) {
        if (tops[c] === 0) continue;
        const [, , x, w] = columns[c];
        ctx.fillRect(x, height, w, (-tops[c] / 255) * height);
      }
      return true;
    };
    const loop = meterLoop(draw);
    loop.setAwake(activeRef.current);
    loopRef.current = loop;

    return () => {
      loop.stop();
      loopRef.current = null;
      master.disconnect(analyser);
    };
  }, [width, height, fftSize, audioCtx, master, scale]);

  React.useEffect(() => {
    activeRef.current = active;
    loopRef.current?.setAwake(active);
  }, [active]);

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
