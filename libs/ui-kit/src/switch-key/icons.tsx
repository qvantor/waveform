import React from 'react';

// icons of the keys of the tempo, 16 × 16 in currentColor: shown at the size of the key's text and up

const Icon = ({ children }: React.PropsWithChildren) => (
  <svg viewBox='0 0 16 16' fill='currentColor' aria-hidden focusable='false'>
    {children}
  </svg>
);

// a quarter note: its head at the bottom left, its stem up from its right
const Quarter = ({ x }: { x: number }) => (
  <>
    <ellipse cx={x} cy={12.3} rx={2.8} ry={2} transform={`rotate(-22 ${x} ${12.3})`} />
    <rect x={x + 1.45} y={2.2} width={1.3} height={10} rx={0.4} />
  </>
);

// the phase anchored to the beats of the transport (HOST)
export const AnchorIcon = () => (
  <Icon>
    <g fill='none' stroke='currentColor' strokeWidth={1.4} strokeLinecap='round' strokeLinejoin='round'>
      <circle cx={8} cy={3.4} r={1.6} />
      <path d='M8 5v9.2M5.2 7.6h5.6' />
      <path d='M2.8 9.4c.3 2.9 2.4 4.8 5.2 4.8s4.9-1.9 5.2-4.8' />
      <path d='M1.6 10.9l1.2-1.6 1.6 1.1M14.4 10.9l-1.2-1.6-1.6 1.1' />
    </g>
  </Icon>
);

// a note with a 3 over its right: triplets
export const TripletIcon = () => (
  <Icon>
    <Quarter x={4.4} />
    <path
      d='M10.2 2.4h3.6l-2 2.3c1.3 0 2.1.8 2.1 1.9 0 1.2-.9 2-2.2 2-.8 0-1.4-.3-1.8-.8'
      fill='none'
      stroke='currentColor'
      strokeWidth={1.3}
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </Icon>
);

// a note with the dot right of its head: dotted
export const DottedIcon = () => (
  <Icon>
    <Quarter x={5.2} />
    <circle cx={11.6} cy={11.6} r={1.5} />
  </Icon>
);
