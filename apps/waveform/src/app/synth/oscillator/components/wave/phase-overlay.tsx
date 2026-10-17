import React from 'react';
import styled from 'styled-components';
import { theme, useLineChartContext } from '@waveform/ui-kit';

interface Props {
  // the wave of the chart and its line data (one period, see Chart)
  wave: number[];
  data: number[];
  phase: number;
  phaseRand: number;
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
export const PhaseOverlay = ({ wave, data, phase, phaseRand, visible }: Props) => {
  const {
    height,
    padding: [, paddingY],
    scaleX,
    scaleY,
    lineFn,
  } = useLineChartContext();
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

  const x = (share: number) => scaleX(1 + share * wave.length);
  const bands = randBands(phase, phaseRand);
  const top = -paddingY;
  const end = phase + phaseRand;
  return (
    <Root data-testid='phase-overlay' style={{ opacity: visible ? 1 : 0 }}>
      <clipPath id={clipId}>
        {bands.map(([from, to]) => (
          <rect key={from} x={x(from)} y={top} width={x(to) - x(from)} height={height} />
        ))}
      </clipPath>
      {bands.map(([from, to]) => (
        <rect
          key={from}
          data-testid='phase-band'
          x={x(from)}
          y={top}
          width={x(to) - x(from)}
          height={height}
          fill={theme.colors.secondAccent}
          fillOpacity={0.18}
        />
      ))}
      {bands.length > 0 && (
        <path
          d={lineFn(data) ?? undefined}
          clipPath={`url(#${clipId})`}
          fill='none'
          stroke={theme.colors.secondAccent}
          strokeWidth={2}
        />
      )}
      {phaseRand > 0 && phaseRand < 1 && (
        <line
          data-testid='phase-band-end'
          x1={x(end - Math.floor(end))}
          x2={x(end - Math.floor(end))}
          y1={top}
          y2={top + height}
          stroke={theme.colors.secondAccent}
          strokeDasharray='3 3'
        />
      )}
      <line
        data-testid='phase-marker'
        x1={x(phase)}
        x2={x(phase)}
        y1={top}
        y2={top + height}
        stroke={theme.colors.white}
        strokeWidth={1.5}
      />
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
