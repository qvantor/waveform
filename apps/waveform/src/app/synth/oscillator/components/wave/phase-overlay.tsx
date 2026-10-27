import React from 'react';
import styled from 'styled-components';
import { BehaviorSubject } from 'rxjs';
import { ChartSvg, strokePath, theme, tracePath, useLineChartContext, useLiveCanvas } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../hooks';
import { DrawnWave, periodX } from './period';

interface Props {
  // the samples of the wave at the knob and the wave drawn (also where the routes of the Wave knob move it)
  length: number;
  $drawn: BehaviorSubject<DrawnWave | null>;
  visible: boolean;
}

// ms the overlay fades out in once Phase and Phase rand are let go
export const PHASE_FADE = 300;

// over the wave (the overlay of the chart)
const Root = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: opacity ${PHASE_FADE}ms;
`;

const DOT_RADIUS = 3.5;

// the value of the wave at a phase (a share of the period): linear between its samples as the line is drawn,
// past the last sample towards the first one
const waveAt = (wave: ArrayLike<number>, phase: number) => {
  const position = phase * wave.length;
  const i = Math.floor(position);
  const a = wave[i % wave.length];
  const b = wave[(i + 1) % wave.length];
  return a + (b - a) * (position - i);
};

// the shares of the period the voices start in, as the voices pick them: phase + a random share up to
// phaseRand, past the end of the period from its start
const randBands = (phase: number, phaseRand: number): [number, number][] => {
  if (phaseRand <= 0) return [];
  const end = phase + phaseRand;
  return end > 1
    ? [
        [phase, 1],
        [0, end - 1],
      ]
    : [[phase, end]];
};

// over the wave while Phase or Phase rand is dragged: the point every voice starts at (phase) and the band
// Phase rand spreads their starts over, the wave in it highlighted; fades out once let go. The highlight and the
// point are on a canvas, drawn again with the wave drawn ($drawn): they follow it without a render
export const PhaseOverlay = ({ length, $drawn, visible }: Props) => {
  const {
    height,
    padding: [, paddingY],
    scaleX,
    scaleY,
  } = useLineChartContext();
  const [{ $osc }] = useOscillatorContext();
  const { phase, phaseRand } = useBehaviorSubject($osc);
  const [canvas, begin] = useLiveCanvas('phase-wave');
  // kept while it fades out, then not rendered at all: no work while the wave morphs
  const [shown, setShown] = React.useState(visible);
  React.useEffect(() => {
    if (visible) {
      setShown(true);
      return;
    }
    const timeout = setTimeout(() => setShown(false), PHASE_FADE);
    return () => clearTimeout(timeout);
  }, [visible]);
  const rendered = (visible || shown) && length > 0;

  const x = React.useCallback((share: number) => scaleX(periodX(share, length)), [scaleX, length]);
  const top = -paddingY;
  const bands = React.useMemo(
    () =>
      randBands(phase, phaseRand).map(([from, to]) => ({
        x: x(from),
        y: top,
        width: x(to) - x(from),
        height,
      })),
    [phase, phaseRand, x, top, height]
  );
  // the wave drawn (its period line) in the bands, the point on it
  const paint = React.useCallback(
    (drawn: DrawnWave | null) => {
      const context = begin();
      if (!context || !drawn || drawn.count === 0) return;
      const { wave, line, count } = drawn;
      if (bands.length > 0) {
        context.save();
        context.beginPath();
        bands.forEach((band) => context.rect(band.x, band.y, band.width, band.height));
        context.clip();
        tracePath(context, count, line.xs, line.ys, line.x, line.y);
        strokePath(context, theme.colors.secondAccent, 2);
        context.restore();
      }
      context.beginPath();
      context.arc(x(phase), scaleY(waveAt(wave, phase)), DOT_RADIUS, 0, 2 * Math.PI);
      context.fillStyle = theme.colors.white;
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = theme.colors.primaryDark;
      context.stroke();
    },
    [begin, bands, x, phase, scaleY]
  );
  React.useLayoutEffect(() => {
    if (!rendered) return;
    const subscription = $drawn.subscribe(paint);
    return () => subscription.unsubscribe();
  }, [rendered, $drawn, paint]);
  if (!rendered) return null;

  // a line across the chart at a phase
  const across = (share: number) => ({ x1: x(share), x2: x(share), y1: top, y2: top + height });
  return (
    <Root data-testid='phase-overlay' style={{ opacity: visible ? 1 : 0 }}>
      <ChartSvg>
        {bands.map((band) => (
          <rect
            key={band.x}
            data-testid='phase-band'
            {...band}
            fill={theme.colors.secondAccent}
            fillOpacity={0.18}
          />
        ))}
        {phaseRand > 0 && phaseRand < 1 && (
          <line
            data-testid='phase-band-end'
            {...across((phase + phaseRand) % 1)}
            stroke={theme.colors.secondAccent}
            strokeDasharray='3 3'
          />
        )}
        <line data-testid='phase-marker' {...across(phase)} stroke={theme.colors.white} strokeWidth={1.5} />
      </ChartSvg>
      {canvas}
    </Root>
  );
};
