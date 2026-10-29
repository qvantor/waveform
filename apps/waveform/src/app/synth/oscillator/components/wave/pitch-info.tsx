import React from 'react';
import cls from 'classnames';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { modSpan } from '../../../common/modulation/modulation-targets';
import { useKnobModulation } from '../../../modulation/use-knob-modulation';
import { useOscillatorContext } from '../../hooks';
import { Cell, Strip } from './value-strip';

// px of drag a step: an octave, a semitone; a cent 2 (±100 in 400 px)
const PX_PER_STEP = 10;
const PX_PER_CENT = 2;

interface Props {
  // the prefix of the modulation targets of the oscillator (osc1.pitch…)
  target: 'osc1' | 'osc2';
  // narrow: the values smaller, without their carets
  compact: boolean;
}

// over the wave, on its background: Oct, Semi and Fine (the pitch of the oscillator over the note), dragged to
// change them; Semi takes the routes of Pitch, Fine those of Fine, Oct none
export const PitchInfo = ({ target, compact }: Props) => {
  const [{ $osc, ranges }, { setOscValue }] = useOscillatorContext();
  const osc = useBehaviorSubject($osc);
  const pitch = `${target}.pitch`;
  const fine = `${target}.fine`;
  const pitchModulation = useKnobModulation(pitch);
  const fineModulation = useKnobModulation(fine);
  const field = (key: 'octave' | 'semi' | 'fine', pxPerStep = PX_PER_STEP) => {
    const [min, max] = ranges[key];
    return {
      value: osc[key],
      min,
      max,
      precision: 1,
      travel: (max - min) * pxPerStep,
      arrows: !compact,
      onChange: (value: number) => setOscValue(key, value),
    };
  };
  return (
    <Strip $edge='top' className={cls({ compact })}>
      <Cell label='Oct' {...field('octave')} />
      <Cell label='Semi' {...field('semi')} modSpan={modSpan(pitch, ranges.semi)} {...pitchModulation} />
      <Cell
        label='Fine'
        {...field('fine', PX_PER_CENT)}
        modSpan={modSpan(fine, ranges.fine)}
        {...fineModulation}
      />
    </Strip>
  );
};
