import React from 'react';

// the y of the two faint guide lines every mode switch icon has
export const GUIDES = [7, 17] as const;

// the frame of the mode switch icons: 56×24 with the guide lines across
export const ModeIcon = ({ testId, children }: React.PropsWithChildren<{ testId: string }>) => (
  <svg width='56' height='24' viewBox='0 0 56 24' data-testid={testId} aria-hidden>
    <g stroke='currentColor' strokeWidth='1' opacity='0.25'>
      {GUIDES.map((y) => (
        <line key={y} x1='2' y1={y} x2='54' y2={y} />
      ))}
    </g>
    {children}
  </svg>
);
