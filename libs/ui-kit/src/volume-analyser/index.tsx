import React from 'react';
import { theme } from '../common/constants';

interface Props {
  analyserNode: AnalyserNode;
  width?: number;
  height?: number;
}

export const VolumeAnalyser = ({ analyserNode, width = 15, height = 60 }: Props) => {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    const ctx = ref.current.getContext('2d') as CanvasRenderingContext2D;
    let animationFrameId: number;
    analyserNode.fftSize = 2048;
    const dataArray = new Float32Array(analyserNode.frequencyBinCount);
    const maxHeight = height * 0.7;

    function draw() {
      animationFrameId = requestAnimationFrame(draw);
      analyserNode.getFloatTimeDomainData(dataArray);
      let sumSquares = 0;
      for (const amplitude of dataArray) {
        sumSquares += amplitude * amplitude;
      }
      const value = Math.sqrt(sumSquares / dataArray.length);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = theme.colors.accent;
      ctx.fillRect(0, height, width, Math.max(-value * maxHeight, -maxHeight));
      if (value > 1) {
        ctx.fillStyle = 'red';
        ctx.fillRect(0, height - maxHeight, width, -(value - 1) * height);
      }
    }

    draw();
    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [analyserNode, height, width]);

  return <canvas ref={ref} width={width} height={height} />;
};
