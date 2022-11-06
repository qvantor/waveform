import React from 'react';
import styled from 'styled-components';
import { theme } from '../common/constants';

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

const ClippingLine = styled.div`
  position: absolute;
  left: 0;
  height: 1px;
  background: ${theme.colors.red};
  opacity: 0.6;
`;

interface Props {
  master: AudioNode;
  audioCtx: AudioContext;
  width?: number;
  height?: number;
  gap?: number;
}

export const VolumeAnalyser = ({ master, audioCtx, width = 40, height = 60, gap = 1 }: Props) => {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const clippingHeight = height * 0.8;

  React.useEffect(() => {
    if (!ref.current) return;
    const analyserL = audioCtx.createAnalyser();
    const analyserR = audioCtx.createAnalyser();
    const splitter = audioCtx.createChannelSplitter(2);
    master.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    const ctx = ref.current.getContext('2d') as CanvasRenderingContext2D;
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, theme.colors.accent);
    gradient.addColorStop(0.65, theme.colors.accent);
    gradient.addColorStop(0.75, theme.colors.thirdAccent);
    gradient.addColorStop(0.85, theme.colors.red);
    gradient.addColorStop(1, theme.colors.red);

    let idleCallback: number;
    analyserL.fftSize = 2048;
    analyserR.fftSize = 2048;

    const dataArrayL = new Float32Array(analyserL.frequencyBinCount);
    const dataArrayR = new Float32Array(analyserR.frequencyBinCount);

    const columnWidth = width / 2 - gap / 2;
    const historyL: number[] = [];
    const historyR: number[] = [];

    //
    function draw() {
      idleCallback = requestIdleCallback(draw);
      analyserL.getFloatTimeDomainData(dataArrayL);
      analyserR.getFloatTimeDomainData(dataArrayR);

      let sumSquaresL = 0;
      let sumSquaresR = 0;

      for (let i = 0; i < analyserL.frequencyBinCount; i++) {
        sumSquaresL += dataArrayL[i] * dataArrayL[i];
        sumSquaresR += dataArrayR[i] * dataArrayR[i];
      }
      const valueL = Math.sqrt(sumSquaresL / dataArrayL.length);
      const valueR = Math.sqrt(sumSquaresR / dataArrayR.length);

      historyL.push(valueL);
      historyR.push(valueR);
      if (historyL.length > 30) historyL.shift();
      if (historyR.length > 30) historyR.shift();

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, height, columnWidth, -valueL * clippingHeight);
      ctx.fillRect(width / 2 + gap / 2, height, columnWidth, -valueR * clippingHeight);

      ctx.fillStyle = theme.colors.thirdAccent;
      ctx.fillRect(0, height - Math.max(...historyL) * height, columnWidth, 1);
      ctx.fillRect(width / 2 + gap / 2, height - Math.max(...historyR) * height, columnWidth, 1);
    }

    requestIdleCallback(draw);
    return () => {
      window.cancelIdleCallback(idleCallback);
    };
  }, [height, width, gap, clippingHeight, audioCtx, master]);

  return (
    <Root style={{ width, height }}>
      <ClippingLine style={{ width, bottom: clippingHeight }} />
      <Separator style={{ height, left: (width - gap) / 2 }} />
      <canvas ref={ref} width={width} height={height} />
    </Root>
  );
};
