import React from 'react';
import { styled } from 'styled-components';
import hexToRgba from 'hex-to-rgba';
import { Deactivated, theme, useCanvas, useElementSize } from '@chisper/ui-kit';
import { useBehaviorSubject } from '@chisper/rxjs-react';
import { useNoise } from '../../common/modules';
import type { NoiseSample } from '../../services';

const Root = styled.div`
  flex: 1 1;
  position: relative;
  min-height: 0;
`;

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
`;

// the lowest and the highest value of every column of `columns` over the sample (its channels together)
export const samplePeaks = ({ channels }: NoiseSample, columns: number) => {
  const peaks = new Float32Array(2 * columns);
  const frames = channels[0]?.length ?? 0;
  if (frames === 0 || columns < 1) return peaks;
  for (let x = 0; x < columns; x++) {
    const from = Math.floor((x * frames) / columns);
    const to = Math.max(from + 1, Math.floor(((x + 1) * frames) / columns));
    let [low, high] = [0, 0];
    for (const channel of channels)
      for (let i = from; i < to && i < frames; i++) {
        low = Math.min(low, channel[i]);
        high = Math.max(high, channel[i]);
      }
    peaks[2 * x] = low;
    peaks[2 * x + 1] = high;
  }
  return peaks;
};

// where notes start: from Start up to Start + Rand² of the sample, not past its end (noise.rs)
export const startSpan = (start: number, rand: number): [number, number] => [
  start,
  Math.min(1, start + rand * rand),
];

// the sample of the noise, its peaks drawn once per sample and size, normalized to its loudest; over it the span
// notes start in (Start, Rand) and a line at Start. Off: faded (Deactivated). It takes the height left (none in the
// short cells of a phone: the controls first)
export const NoiseOverview = () => {
  const [{ $sample, $noise, $active }] = useNoise();
  const sample = useBehaviorSubject($sample);
  const { start, rand } = useBehaviorSubject($noise);
  const active = useBehaviorSubject($active);
  const [ref, [width, height]] = useElementSize<HTMLDivElement>();
  const { canvas, begin } = useCanvas(width, height);
  const columns = Math.floor(width);
  const peaks = React.useMemo(() => (sample ? samplePeaks(sample, columns) : null), [sample, columns]);

  React.useEffect(() => {
    const context = begin();
    if (!context || width === 0 || height === 0) return;
    const middle = height / 2;
    if (peaks) {
      let loudest = 0;
      for (let i = 0; i < peaks.length; i++) loudest = Math.max(loudest, Math.abs(peaks[i]));
      const scale = loudest > 0 ? (middle - 2) / loudest : 0;
      context.fillStyle = hexToRgba(theme.colors.secondAccent, 0.75);
      for (let x = 0; x < columns; x++) {
        const top = middle - peaks[2 * x + 1] * scale;
        const bottom = middle - peaks[2 * x] * scale;
        context.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    } else {
      context.fillStyle = theme.colors.primaryDarkMediumContrast;
      context.fillRect(0, middle, width, 1);
    }
    const [from, to] = startSpan(start, rand);
    if (to > from) {
      context.fillStyle = hexToRgba(theme.colors.accent, 0.18);
      context.fillRect(from * width, 0, (to - from) * width, height);
    }
    context.fillStyle = theme.colors.accent;
    context.fillRect(Math.min(width - 1, from * width), 0, 1, height);
  }, [begin, peaks, columns, width, height, start, rand]);

  return (
    <Root ref={ref}>
      <Canvas {...canvas} aria-label='The sample of the noise' role='img' />
      {!active && <Deactivated />}
    </Root>
  );
};
