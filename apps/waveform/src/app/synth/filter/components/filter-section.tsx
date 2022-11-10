import React from 'react';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { Filter, Section } from '@waveform/ui-kit';
import { useFilter } from '../modules';

export const FilterSection = () => {
  const [{ $filter, $filterType, $active, $ranges }, { toggleActive, setType, setNumericValue }] =
    useFilter();
  const active = useBehaviorSubject($active);
  const filter = useBehaviorSubject($filter);
  const filterType = useBehaviorSubject($filterType);
  const ranges = useBehaviorSubject($ranges);

  return (
    <Section name='Filter' active={active} onClick={toggleActive}>
      <Filter
        {...filter}
        type={filterType}
        ranges={ranges}
        setType={setType}
        setNumericValue={setNumericValue}
        active={active}
      />
    </Section>
  );
};
