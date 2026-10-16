import React from 'react';
import { FxType } from '@waveform/preset-schema';

// fills its badge: a window onto the signal, the traces run on through its edges (the svg clips them), so
// they need no caps there; the stroke is thinner than 2 for the bigger size
const Icon = ({ children }: React.PropsWithChildren) => (
  <svg
    width='100%'
    height='100%'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.6'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden
  >
    {children}
  </svg>
);

// a wave cycle and its echoes on one trace: the same period, the amplitude dies out; the pieces meet end to
// end, butt caps, so the joints don't double up
const DelayIcon = () => (
  <Icon>
    <g strokeLinecap='butt'>
      <path d='M-1 12 H1.5 Q3 -4 4.5 12 T7.5 12 H9' />
      <path d='M9 12 Q10.5 2 12 12 T15 12 H16.5' opacity='0.6' />
      <path d='M16.5 12 Q18 7 19.5 12 T22.5 12 H25' opacity='0.35' />
    </g>
  </Icon>
);

// a sound source and its reflections spreading into the room, fading with the distance
const ReverbIcon = () => (
  <Icon>
    <circle cx='5' cy='12' r='1.5' fill='currentColor' stroke='none' />
    <path d='M9 7.5 A6.5 6.5 0 0 1 9 16.5' />
    <path d='M12.5 4.5 A10.5 10.5 0 0 1 12.5 19.5' opacity='0.6' />
    <path d='M16 2 A14 14 0 0 1 16 22' opacity='0.35' />
  </Icon>
);

// a sine driven far over the ceiling (faint, its peaks run out of it) and what comes out: the peaks cut flat
// at half its height, nearly a square wave; the cut runs where the sine crosses the ceiling. Both run on
// past the edges
const DistortionIcon = () => (
  <Icon>
    <path d='M-3.75 12 Q-1.12 34 1.5 12 T6.75 12 T12 12 T17.25 12 T22.5 12 T27.75 12' opacity='0.35' />
    <path d='M-1 17 H0.81 L2.19 7 H6.06 L7.44 17 H11.31 L12.69 7 H16.56 L17.94 17 H21.81 L23.19 7 H25' />
  </Icon>
);

// shown in the effects list
export const FX_ICONS: Record<FxType, React.ComponentType> = {
  distortion: DistortionIcon,
  delay: DelayIcon,
  reverb: ReverbIcon,
};
