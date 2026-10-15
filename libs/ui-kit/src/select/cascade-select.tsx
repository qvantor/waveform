import React from 'react';
import styled from 'styled-components';
import { Cascader, Spin } from 'antd';
import { isEqual } from 'lodash';
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

// a folder alone on its level (the only wavetable pack) is chosen for the user: the cascader starts inside it
export const skipSingleFolders = (
  options: CascadeOption[],
  prefix: string[] = []
): { prefix: string[]; options: CascadeOption[] } => {
  const [single] = options;
  if (options.length !== 1 || !('children' in single)) return { prefix, options };
  return skipSingleFolders(single.children, [...prefix, single.value]);
};

// value and setValue are whole paths, the single folders included
export const CascadeSelect = ({
  options,
  value,
  setValue,
  loading,
  children,
}: React.PropsWithChildren<Props>) => {
  const leaves = React.useMemo(() => leafPaths(options), [options]);
  const { prefix, options: shownOptions } = skipSingleFolders(options);
  // a value out of the skipped folders is passed as it is
  const shownValue = prefix.every((key, i) => value[i] === key) ? value.slice(prefix.length) : value;
  // the arrows go through all the files across folders and wrap around; from an unknown value (-1) next is
  // the first, previous the last. A value without the skipped folders is shown as chosen, so it is found too
  const step = (delta: number) => () => {
    if (leaves.length === 0) return;
    const current = leaves.findIndex((leaf) => isEqual(leaf, value) || isEqual(leaf, [...prefix, ...value]));
    const index = current === -1 && delta < 0 ? -1 : current + delta;
    setValue(leaves[(index + leaves.length) % leaves.length]);
  };
  // a cleared cascader reports undefined: the value is kept, a file stays chosen
  const onChange = (path?: (string | number)[]) => {
    if (path?.length) setValue([...prefix, ...path]);
  };

  return (
    <SelectDumbInternal prev={step(-1)} next={step(1)}>
      <Spin spinning={loading}>
        <Cascader options={shownOptions} onChange={onChange} value={shownValue}>
          <Root>{children}</Root>
        </Cascader>
      </Spin>
    </SelectDumbInternal>
  );
};
