import React, { ChangeEvent } from 'react';
import styled from 'styled-components';
import { theme } from '../common/constants';
import { SelectDumb, ContentContainer } from './select-dumb';

export { CascadeSelect } from './cascade-select';
export type { CascadeOption } from './cascade-select';

const Root = styled.select`
  ${ContentContainer}

  /* the native option list would inherit the white text, its background is up to the OS (dark in a dark theme) */
  option,
  optgroup {
    color: ${theme.colors.primaryDark};
    background: ${theme.colors.white};
  }
`;

interface Option<T> {
  name: React.ReactNode;
  value: T;
  // the options of a group in a row are listed under its label
  group?: string;
  // shown while it is the value, never chosen (the arrows step over it)
  disabled?: boolean;
}

interface Props<T> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  // ◀ ▶ step through the options; false for a choice that costs (each step would be one)
  arrows?: boolean;
}

// the options in runs of one group (or of none)
const groupRuns = <T,>(options: Option<T>[]) =>
  options.reduce<{ group?: string; options: Option<T>[] }[]>((runs, option) => {
    const last = runs[runs.length - 1];
    if (last && last.group === option.group) last.options.push(option);
    else runs.push({ group: option.group, options: [option] });
    return runs;
  }, []);

export const Select = <T extends string | number>({ value, options, onChange, arrows = true }: Props<T>) => {
  const onChangeInternal = (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as T);
  // around the options that can be chosen; from a value that is none of them next is the first, previous the last
  const step = (delta: number) => () => {
    const choices = options.filter((option) => !option.disabled);
    const current = choices.findIndex((option) => option.value === value);
    const index = current === -1 && delta < 0 ? -1 : current + delta;
    onChange(choices[(index + choices.length) % choices.length].value);
  };
  const renderOption = (option: Option<T>) => (
    <option key={option.value} value={option.value} disabled={option.disabled}>
      {option.name}
    </option>
  );

  return (
    <SelectDumb {...(arrows && { prev: step(-1), next: step(1) })}>
      <Root value={value} onChange={onChangeInternal}>
        {groupRuns(options).map(({ group, options }) =>
          group === undefined ? (
            options.map(renderOption)
          ) : (
            <optgroup key={group} label={group}>
              {options.map(renderOption)}
            </optgroup>
          )
        )}
      </Root>
    </SelectDumb>
  );
};
