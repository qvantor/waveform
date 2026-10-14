import React from 'react';
import { GUIDES, ModeIcon as Icon } from './mode-icon';

// echoes over time (left to right) in the left (top row) and the right (bottom row) channel
const STEPS = [8, 20, 32, 44];
const [L, R] = GUIDES;

const Echo = ({ x, y, step }: { x: number; y: number; step: number }) => (
  <circle cx={x} cy={y} r={3 - step * 0.5} fill='currentColor' opacity={1 - step * 0.22} />
);

// both channels repeat together
export const NormalIcon = () => (
  <Icon testId='delay-mode-normal'>
    {STEPS.map((x, step) => (
      <React.Fragment key={x}>
        <Echo x={x} y={L} step={step} />
        <Echo x={x} y={R} step={step} />
      </React.Fragment>
    ))}
  </Icon>
);

// the echoes bounce between the channels
export const PingPongIcon = () => (
  <Icon testId='delay-mode-ping-pong'>
    <polyline
      points={STEPS.map((x, step) => `${x},${step % 2 ? R : L}`).join(' ')}
      fill='none'
      stroke='currentColor'
      strokeWidth='1'
      opacity='0.6'
    />
    {STEPS.map((x, step) => (
      <Echo key={x} x={x} y={step % 2 ? R : L} step={step} />
    ))}
  </Icon>
);
