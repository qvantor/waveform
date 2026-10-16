import React from 'react';
import { DISTORTION_MODES, DistortionMode } from '../../effects/distortion-modes';
import { GUIDES, ModeIcon } from './mode-icon';

// the curve of the mode across the frame: the input from -1 (left) to 1 (right), the guides are ±1 of the
// output; driven so hard that the curves differ at a glance
const [TOP, BOTTOM] = GUIDES;
const LEFT = 8;
const RIGHT = 48;
const ICON_DRIVE = 2.5;

export const modeCurve = ({ shape }: Pick<DistortionMode, 'shape'>): [number, number][] =>
  Array.from({ length: RIGHT - LEFT + 1 }, (_, i) => {
    const x = -1 + (2 * i) / (RIGHT - LEFT);
    const y = shape(ICON_DRIVE * x);
    return [LEFT + i, Number(((TOP + BOTTOM) / 2 - (y * (BOTTOM - TOP)) / 2).toFixed(2))];
  });

const DistortionModeIcon = ({ mode }: { mode: DistortionMode }) => (
  <ModeIcon testId={`distortion-mode-${mode.id}`}>
    <polyline
      points={modeCurve(mode)
        .map(([x, y]) => `${x},${y}`)
        .join(' ')}
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </ModeIcon>
);

export const DISTORTION_MODE_ICONS: Record<string, React.ReactNode> = Object.fromEntries(
  DISTORTION_MODES.map((mode) => [mode.id, <DistortionModeIcon key={mode.id} mode={mode} />])
);
