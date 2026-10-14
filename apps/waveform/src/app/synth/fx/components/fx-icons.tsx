import React from 'react';
import { FxType } from '@waveform/preset-schema';

const Icon = ({ children }: React.PropsWithChildren) => (
  <svg
    width='1em'
    height='1em'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden
  >
    {children}
  </svg>
);

// a wave cycle and its echoes: the same period, the amplitude dies out
const DelayIcon = () => (
  <Icon>
    <path d='M1.5 12 Q3 -4 4.5 12 T7.5 12' />
    <path d='M9 12 Q10.5 2 12 12 T15 12' opacity='0.6' />
    <path d='M16.5 12 Q18 7 19.5 12 T22.5 12' opacity='0.35' />
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

// shown in the effects list
export const FX_ICONS: Record<FxType, React.ComponentType> = { delay: DelayIcon, reverb: ReverbIcon };
