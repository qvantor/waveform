import React from 'react';
import styled from 'styled-components';
import { Cascader, Spin } from 'antd';
import { SelectDumb, ContentContainer } from './select-dumb';

const Root = styled.div`
  ${ContentContainer}
`;

const SelectDumbInternal = styled(SelectDumb)`
  .ant-spin-nested-loading {
    width: 100%;
  }
`;

type CascadeOptionWithChildren = {
  value: string;
  label: React.ReactNode;
  children: CascadeOption[];
};

type CascadeOptionValue = {
  value: string;
  label: React.ReactNode;
};

export type CascadeOption = CascadeOptionWithChildren | CascadeOptionValue;

interface Props {
  options: CascadeOption[];
  value: (string | number)[];
  setValue: (value: (string | number)[]) => void;
  loading: boolean;
}

// paths of the files (options without children) in the order they are shown
const leafPaths = (options: CascadeOption[], parent: string[] = []): string[][] =>
  options.flatMap((option) =>
    'children' in option ? leafPaths(option.children, [...parent, option.value]) : [[...parent, option.value]]
  );

export const CascadeSelect = ({
  options,
  value,
  setValue,
  loading,
  children,
}: React.PropsWithChildren<Props>) => {
  const leaves = React.useMemo(() => leafPaths(options), [options]);
  // the arrows go through all the files across folders and wrap around; from an unknown value next is the first
  const step = (delta: number) => () => {
    if (leaves.length === 0) return;
    const current = leaves.findIndex(
      (leaf) => leaf.length === value.length && leaf.every((key, i) => key === value[i])
    );
    const index = current === -1 ? (delta > 0 ? 0 : leaves.length - 1) : current + delta;
    setValue(leaves[(index + leaves.length) % leaves.length]);
  };

  return (
    <SelectDumbInternal prev={step(-1)} next={step(1)}>
      <Spin spinning={loading}>
        <Cascader options={options} onChange={setValue} value={value}>
          <Root>{children}</Root>
        </Cascader>
      </Spin>
    </SelectDumbInternal>
  );
};
