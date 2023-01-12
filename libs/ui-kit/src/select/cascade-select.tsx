import React from 'react';
import styled from 'styled-components';
import { Cascader, Spin } from 'antd';
import { noop } from 'rxjs';
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

export const CascadeSelect = ({
  options,
  value,
  setValue,
  loading,
  children,
}: React.PropsWithChildren<Props>) => {
  return (
    <SelectDumbInternal prev={noop} next={noop}>
      <Spin spinning={loading}>
        <Cascader options={options} onChange={setValue} value={value}>
          <Root>{children}</Root>
        </Cascader>
      </Spin>
    </SelectDumbInternal>
  );
};
