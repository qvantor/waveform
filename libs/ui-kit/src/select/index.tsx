import React, { ChangeEvent } from 'react';
import styled from 'styled-components';
import { SelectDumb, ContentContainer } from './select-dumb';

export { CascadeSelect } from './cascade-select';
export type { CascadeOption } from './cascade-select';

const Root = styled.select`
  ${ContentContainer}
`;

interface Props<T> {
  value: T;
  options: Array<{ name: React.ReactNode; value: T }>;
  onChange: (value: T) => void;
}

export const Select = <T extends string | number>({ value, options, onChange }: Props<T>) => {
  const onChangeInternal = (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as T);
  const setNext = () => {
    const current = options.findIndex((option) => option.value === value);
    const next = options[current + 1];
    if (next) onChange(next.value);
    else onChange(options[0].value);
  };
  const setPrev = () => {
    const current = options.findIndex((option) => option.value === value);
    const prev = options[current - 1];
    if (prev) onChange(prev.value);
    else onChange(options[options.length - 1].value);
  };

  return (
    <SelectDumb prev={setPrev} next={setNext}>
      <Root value={value} onChange={onChangeInternal}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.name}
          </option>
        ))}
      </Root>
    </SelectDumb>
  );
};
