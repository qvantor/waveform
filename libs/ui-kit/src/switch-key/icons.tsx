import React from 'react';

// icons of the keys of the tempo and of the noise, 16 × 16 in currentColor: shown at the size of the key's text and
// up

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

const LINE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// a sample played around and around: a loop of an arrow
export const LoopIcon = () => (
  <Icon>
    <g {...LINE}>
      <path d='M3 9.2V7.6a3 3 0 0 1 3-3h7' />
      <path d='M11 2.6l2 2-2 2' />
      <path d='M13 6.8v1.6a3 3 0 0 1-3 3H3' />
      <path d='M5 13.4l-2-2 2-2' />
    </g>
  </Icon>
);

// a sample played once: an arrow up to a stop
export const OneShotIcon = () => (
  <Icon>
    <g {...LINE}>
      <path d='M2 8h9' />
      <path d='M8 5l3 3-3 3' />
      <path d='M13.6 3.6v8.8' />
    </g>
  </Icon>
);

// the pitch following the keys: two keys of a keyboard under a rising arrow
export const TrackIcon = () => (
  <Icon>
    <g {...LINE}>
      <rect x={2.2} y={8.4} width={4.8} height={6} rx={0.6} />
      <rect x={9} y={8.4} width={4.8} height={6} rx={0.6} />
      <path d='M3 5.6l4-3.2 2.6 2 3.6-3' />
      <path d='M11 1.4h2.2v2.2' />
    </g>
  </Icon>
);
