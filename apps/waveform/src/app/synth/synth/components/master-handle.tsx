import React from 'react';
import { number } from '@waveform/math';
import { Handle } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useSynthCore } from '../../common/modules';

// the master volume in dB, like the output of a hardware synth: above 0 dB it drives the master limiter,
// which keeps the peaks at its ceiling, so the sound gets louder without clipping. The lowest position is
// silence
export const MASTER_DB = { min: -40, max: 12 };

export const dbToGain = (db: number) => (db <= MASTER_DB.min ? 0 : 10 ** (db / 20));

export const gainToDb = (gain: number) =>
  gain <= 0 ? MASTER_DB.min : number.thresholds(20 * Math.log10(gain), MASTER_DB.min, MASTER_DB.max);

export const formatDb = (db: number) => {
  if (db <= MASTER_DB.min) return '-∞';
  const value = number.round(db, 10);
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}dB`;
};

export const MasterHandle = ({ label = 'Master' }: { label?: string | null }) => {
  const [{ $masterGain }, { setMasterGain }] = useSynthCore();
  const gain = useBehaviorSubject($masterGain);
  const onChange = React.useCallback((db: number) => setMasterGain(dbToGain(db)), [setMasterGain]);
  return (
    <Handle
      min={MASTER_DB.min}
      max={MASTER_DB.max}
      value={gainToDb(gain)}
      onChange={onChange}
      label={label}
      name='Master volume'
      formatValue={formatDb}
      precision={10}
    />
  );
};
