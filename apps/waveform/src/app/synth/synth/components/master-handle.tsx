import React from 'react';
import { number } from '@waveform/math';
import { RxHandle } from '../../../common/components';
import { useSynthCore } from '../../common/modules';

export const MasterHandle = ({ label = 'Master' }: { label?: string | null }) => {
  const [{ $masterGain }, { setMasterGain }] = useSynthCore();
  return (
    <RxHandle
      min={0}
      max={1.3}
      $value={$masterGain}
      onChange={setMasterGain}
      label={label}
      formatValue={(value) => number.percent(number.round(value, 100))}
      precision={100}
    />
  );
};
