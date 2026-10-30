import React from 'react';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { Filter, FilterNumerics, Section } from '@waveform/ui-kit';
import { PRESET_DEFAULTS } from '@waveform/preset-schema';
import { useFilter } from '../modules';
import { useKnobModulation } from '../../modulation/use-knob-modulation';
import { filterTargetScale } from '../../common/modulation/modulation-targets';

// the knobs of an empty preset (within the range of the type: the knob clamps them)
const DEFAULTS = {
  cutoff: PRESET_DEFAULTS.filter.cut,
  resonance: PRESET_DEFAULTS.filter.res,
  gain: PRESET_DEFAULTS.filter.gain,
};

export const FilterSection = () => {
  const [{ $filter, $filterType, $active, $ranges, sampleRate }, { toggleActive, setType, setNumericValue }] =
    useFilter();
  const active = useBehaviorSubject($active);
  const filter = useBehaviorSubject($filter);
  const filterType = useBehaviorSubject($filterType);
  const ranges = useBehaviorSubject($ranges);
  // the amounts in the scale of the knob for the type (a knob the type doesn't use is disabled: its routes hide)
  const knob = (param: FilterNumerics) => filterTargetScale(filterType, param);
  const modulation = {
    cutoff: useKnobModulation('filter.cutoff', knob('cutoff')),
    resonance: useKnobModulation('filter.resonance', knob('resonance')),
    gain: useKnobModulation('filter.gain', knob('gain')),
  };

  return (
    <Section name='Filter' active={active} onClick={toggleActive}>
      <Filter
        {...filter}
        type={filterType}
        ranges={ranges}
        setType={setType}
        setNumericValue={setNumericValue}
        active={active}
        sampleRate={sampleRate}
        modulation={modulation}
        defaults={DEFAULTS}
      />
    </Section>
  );
};
