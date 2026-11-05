import React from 'react';
import { styled } from 'styled-components';
import { Cascader, Spin } from 'antd';
import { isEqual } from 'lodash';
import { MiddleEllipsis } from '../middle-ellipsis';
import { SelectDumb, ContentContainer } from './select-dumb';

// a name longer than its place is cut in its middle (it never widens the row)
const Root = styled.div`
  ${ContentContainer}
  /* the Spin of antd 6 around it sets a line height of its own: the row as high as the other selects */
  line-height: normal;
`;

const SelectDumbInternal = styled(SelectDumb)`
  min-width: 0;
`;

// the Spin around the name takes the room the arrows leave, never more: a long name is cut, the row stays as wide
// as its place
const Loading = styled(Spin)`
  flex: 1 1 0;
  min-width: 0;
`;

type CascadeOptionWithChildren = {
  value: string;
  label: string;
  children: CascadeOption[];
};

type CascadeOptionValue = {
  value: string;
  label: string;
};

export type CascadeOption = CascadeOptionWithChildren | CascadeOptionValue;

interface Props {
  options: CascadeOption[];
  value: (string | number)[];
  setValue: (value: (string | number)[]) => void;
  loading: boolean;
  // the name shown of the value
  label: string;
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
export const CascadeSelect = ({ options, value, setValue, loading, label }: Props) => {
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
      <Loading spinning={loading}>
        {/* the values of the options are strings (the names of the folders and the files) */}
        <Cascader options={shownOptions} onChange={onChange} value={shownValue as string[]}>
          <Root>
            <MiddleEllipsis text={label} />
          </Root>
        </Cascader>
      </Loading>
    </SelectDumbInternal>
  );
};
