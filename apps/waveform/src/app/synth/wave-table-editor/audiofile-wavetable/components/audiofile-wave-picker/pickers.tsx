import React from 'react';
import { number } from '@waveform/math';
import { theme, useLineChartContext } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../../../oscillator';
import { useAudiofile } from '../../modules';

export const Pickers = () => {
  const { scaleX, height, padding } = useLineChartContext();
  const [{ $wavePickers, $waveSize }] = useAudiofile();
  const [{ $current }] = useOscillatorContext();
  const wavePickers = useBehaviorSubject($wavePickers);
  const waveSize = useBehaviorSubject($waveSize);
  const current = useBehaviorSubject($current);

  const width = scaleX(number.powerOfTwo(waveSize));
  return (
    <g>
      {wavePickers.map((x, i) => (
        <g transform={`translate(${scaleX(x)},0)`} key={i}>
          <line
            style={{
              stroke: theme.colors.thirdAccent,
              opacity: current === i ? 1 : 0.5,
            }}
            y1={0}
            y2={height - padding[1] * 2}
          />
          <rect
            width={width}
            height={height - padding[1] * 2}
            style={{ fill: theme.colors.thirdAccent, fillOpacity: 0.1 }}
          />
        </g>
      ))}
    </g>
  );
};
