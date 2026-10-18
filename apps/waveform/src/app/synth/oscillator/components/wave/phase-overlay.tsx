import React from 'react';
import styled from 'styled-components';
import { Line, theme, useLineChartContext } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../hooks';
import { periodX } from './period';

interface Props {
  // the wave of the chart and its line (periodLine)
  wave: number[];
  line: number[];
  visible: boolean;
}

// ms the overlay fades out in once Phase and Phase rand are let go
export const PHASE_FADE = 300;

const Root = styled.g`
  pointer-events: none;
  transition: opacity ${PHASE_FADE}ms;
`;

// the value of the wave at a phase (a share of the period): linear between its samples as the line is drawn,
// past the last sample towards the first one
const waveAt = (wave: number[], phase: number) => {
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
// Phase rand spreads their starts over, the wave in it highlighted; fades out once let go
export const PhaseOverlay = ({ wave, line, visible }: Props) => {
  const {
    height,
    padding: [, paddingY],
    scaleX,
    scaleY,
  } = useLineChartContext();
  const [{ $osc }] = useOscillatorContext();
  const { phase, phaseRand } = useBehaviorSubject($osc);
  const clipId = `phase-band-${React.useId().replace(/:/g, '')}`;
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
  if (!(visible || shown) || wave.length === 0) return null;

  const x = (share: number) => scaleX(periodX(share, wave.length));
  const top = -paddingY;
  const bands = randBands(phase, phaseRand).map(([from, to]) => ({
    x: x(from),
    y: top,
    width: x(to) - x(from),
    height,
  }));
  // a line across the chart at a phase
  const across = (share: number) => ({ x1: x(share), x2: x(share), y1: top, y2: top + height });
  return (
    <Root data-testid='phase-overlay' style={{ opacity: visible ? 1 : 0 }}>
      <clipPath id={clipId}>
        {bands.map((band) => (
          <rect key={band.x} {...band} />
        ))}
      </clipPath>
      {bands.map((band) => (
        <rect
          key={band.x}
          data-testid='phase-band'
          {...band}
          fill={theme.colors.secondAccent}
          fillOpacity={0.18}
        />
      ))}
      {bands.length > 0 && (
        <g clipPath={`url(#${clipId})`}>
          <Line data={line} style={{ stroke: theme.colors.secondAccent }} />
        </g>
      )}
      {phaseRand > 0 && phaseRand < 1 && (
        <line
          data-testid='phase-band-end'
          {...across((phase + phaseRand) % 1)}
          stroke={theme.colors.secondAccent}
          strokeDasharray='3 3'
        />
      )}
      <line data-testid='phase-marker' {...across(phase)} stroke={theme.colors.white} strokeWidth={1.5} />
      <circle
        data-testid='phase-dot'
        cx={x(phase)}
        cy={scaleY(waveAt(wave, phase))}
        r={3.5}
        fill={theme.colors.white}
        stroke={theme.colors.primaryDark}
        strokeWidth={1.5}
      />
    </Root>
  );
};
