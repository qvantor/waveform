import React from 'react';
import styled from 'styled-components';
import { BehaviorSubject } from 'rxjs';
import { theme, useLineChartContext } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../hooks';
import { periodX } from './period';

interface Props {
  // the id of the path of the wave, the samples of the wave at the knob and the wave drawn (also where the
  // routes of the Wave knob move it)
  lineId: string;
  length: number;
  $drawn: BehaviorSubject<ArrayLike<number>>;
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
// Phase rand spreads their starts over, the wave in it highlighted; fades out once let go. The highlight is the
// path of the wave (<use>) and the point is moved onto the wave drawn: both follow it without a render
export const PhaseOverlay = ({ lineId, length, $drawn, visible }: Props) => {
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
  const rendered = (visible || shown) && length > 0;
  const dot = React.useRef<SVGCircleElement>(null);
  React.useLayoutEffect(() => {
    if (!rendered) return;
    const subscription = $drawn.subscribe((wave) => {
      if (wave.length > 0) dot.current?.setAttribute('cy', String(scaleY(waveAt(wave, phase))));
    });
    return () => subscription.unsubscribe();
  }, [rendered, $drawn, phase, scaleY]);
  if (!rendered) return null;

  const x = (share: number) => scaleX(periodX(share, length));
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
          <use
            href={`#${lineId}`}
            style={{ stroke: theme.colors.secondAccent, strokeWidth: 2, fill: 'transparent' }}
          />
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
        ref={dot}
        data-testid='phase-dot'
        cx={x(phase)}
        r={3.5}
        fill={theme.colors.white}
        stroke={theme.colors.primaryDark}
        strokeWidth={1.5}
      />
    </Root>
  );
};
