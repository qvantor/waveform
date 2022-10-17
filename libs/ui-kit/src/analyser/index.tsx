import React from 'react';
import styled from 'styled-components';
import { number } from '@waveform/math';
import { theme } from '@waveform/ui-kit';

interface Props {
  analyser: AnalyserNode;
  fftSize?: number;
}

const Canvas = styled.canvas`
  position: absolute;
`;

export const Analyser = ({ analyser, fftSize = 9 }: Props) => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [[width, height], setSize] = React.useState<[number, number]>([300, 150]);

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
    let animationFrameId: number;
    const ctx = ref.current.getContext('2d') as CanvasRenderingContext2D;
    analyser.fftSize = number.powerOfTwo(fftSize);
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);
      // analyser.getByteFrequencyData(frequencyData);
      ctx.fillStyle = theme.colors.primaryDark;
      ctx.fillRect(0, 0, width, height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.colors.accent;
      ctx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * (height / 2);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        // ctx.fillStyle = 'rgba(52, 152, 219, 0.7)';
        // ctx.fillRect(x, size[1] + 10, sliceWidth, -frequencyData[i]);
        x += sliceWidth;
      }
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    }

    draw();
    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [width, height, analyser, fftSize]);

  return (
    <div ref={rootRef}>
      <Canvas ref={ref} height={height} width={width} />
    </div>
  );
};
