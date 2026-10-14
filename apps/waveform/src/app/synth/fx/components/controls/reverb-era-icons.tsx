import React from 'react';
import { number } from '@waveform/math';
import { REVERB_ERAS, ReverbEra } from '../../effects/reverb-era';
import { GUIDES, ModeIcon } from './mode-icon';

// a sketch of the tone of the era, frequency left to right: the top guide is 0 dB, the body is a bump
// on the left and the bandwidth bends the line down to the floor
const [TOP] = GUIDES;
const FLOOR = 22;
const LEFT = 2;
const RIGHT = 54;
// schematic log axis for the bandwidth: 1 kHz at the left edge, 20 kHz at the right one
const kneeX = (bandwidth: number) => LEFT + ((RIGHT - LEFT) * Math.log(bandwidth / 1000)) / Math.log(20);
// px from the knee down to the floor
const ROLLOFF = 12;
const BODY_X = 9;
const BODY_WIDTH = 4;
// px per dB of body
const BODY_SCALE = 1.2;

export const eraCurve = ({ bandwidth, body }: Pick<ReverbEra, 'bandwidth' | 'body'>): [number, number][] =>
  Array.from({ length: RIGHT - LEFT + 1 }, (_, i) => {
    const x = LEFT + i;
    const bump = body * BODY_SCALE * Math.exp(-(((x - BODY_X) / BODY_WIDTH) ** 2));
    const t = bandwidth === null ? 0 : number.thresholds((x - kneeX(bandwidth)) / ROLLOFF, 0, 1);
    return [x, Number((TOP - bump + (FLOOR - TOP) * t * t).toFixed(2))];
  });

const EraIcon = ({ era }: { era: ReverbEra }) => {
  const curve = eraCurve(era);
  const points = curve.map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <ModeIcon testId={`reverb-era-${era.id}`}>
      <polygon points={`${LEFT},24 ${points} ${RIGHT},24`} fill='currentColor' opacity='0.15' />
      <polyline
        points={points}
        fill='none'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </ModeIcon>
  );
};

export const ERA_ICONS: Record<string, React.ReactNode> = Object.fromEntries(
  REVERB_ERAS.map((era) => [era.id, <EraIcon key={era.id} era={era} />])
);
