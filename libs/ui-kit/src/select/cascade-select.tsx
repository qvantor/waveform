import React from 'react';
import styled from 'styled-components';
import { Cascader } from 'antd';
import { noop } from 'rxjs';
import { SelectDumb, ContentContainer } from './select-dumb';

const Root = styled.div`
  ${ContentContainer}
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
}

export const CascadeSelect = ({ options, value, setValue, children }: React.PropsWithChildren<Props>) => {
  return (
    <SelectDumb prev={noop} next={noop}>
      <Cascader options={options} onChange={setValue} value={value}>
        <Root>{children}</Root>
      </Cascader>
    </SelectDumb>
  );
};
