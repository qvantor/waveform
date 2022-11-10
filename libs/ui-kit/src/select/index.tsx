import React, { ChangeEvent } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import styled from 'styled-components';
import { theme } from '../common/constants';

const SelectContainer = styled.div`
  display: flex;
  align-items: center;
  background: ${theme.colors.primaryDark};
  border-radius: 3px;
  cursor: pointer;
  gap: 7px;
  width: 100%;
`;

const Root = styled.select`
  flex: 1 1;
  background: transparent;
  color: ${theme.colors.white};
  appearance: none;
  border: none;
  padding: 3px 6px;

  &:focus {
    outline: none;
  }
`;

const ArrowIcons = styled.div`
  display: flex;
  margin: -3px -6px;
  padding-left: 6px;

  button {
    cursor: pointer;
    color: ${theme.colors.white};
    padding: 3px;
    border-radius: 3px;
    border: none;
    background: ${theme.colors.primaryDark};
    transition: all 150ms;

    &:hover {
      background: ${theme.colors.primaryDarkHighContrast};
    }

    &:active {
      background: ${theme.colors.primaryDarkMediumContrast};
    }
  }
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
    <SelectContainer>
      <ArrowIcons>
        <button onClick={setPrev}>
          <LeftOutlined />
        </button>
        <button onClick={setNext}>
          <RightOutlined />
        </button>
      </ArrowIcons>
      <Root value={value} onChange={onChangeInternal}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.name}
          </option>
        ))}
      </Root>
    </SelectContainer>
  );
};
