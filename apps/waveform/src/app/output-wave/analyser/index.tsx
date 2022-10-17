import React from 'react';
import { useAppContext } from '../../app';
import { theme } from '@waveform/ui-kit';

export const Analyser = () => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const ref = React.useRef<HTMLCanvasElement>(null);
  const {
    context: { analyser },
  } = useAppContext();
  const [size, setSize] = React.useState<[number, number]>([300, 150]);

  React.useEffect(() => {
    if (!ref.current) return;
    let animationFrameId: number;
    const ctx = ref.current.getContext('2d') as CanvasRenderingContext2D;
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);
      ctx.fillStyle = theme.colors.primaryDark;
      ctx.fillRect(0, 0, size[0], size[1]);

      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.colors.secondAccent;
      ctx.beginPath();

      const sliceWidth = size[0] / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * (size[1] / 2);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }
      ctx.lineTo(size[0], size[1] / 2);
      ctx.stroke();
    }

    draw();
    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [size, analyser]);

  React.useEffect(() => {
    const onResize = () => {
      if (!rootRef.current) return;
      setSize([rootRef.current.clientWidth, rootRef.current.clientHeight]);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div style={{ background: 'black' }} ref={rootRef}>
      <canvas ref={ref} width={size[0]} height={size[1]} />
    </div>
  );
};
