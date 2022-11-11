import React from 'react';
import cls from 'classnames';
import styled from 'styled-components';
import { theme } from '../common/constants';
import { Label } from '../label';

const Root = styled.div`
  display: flex;
  gap: 5px;
  align-items: center;
`;

const Indicator = styled.div`
  width: 12px;
  height: 12px;
  background: ${theme.colors.primaryHighContrast};
  border: 1px solid ${theme.colors.primaryDarkMediumContrast};
  border-radius: 3px;
  box-shadow: none;
  transition: all 150ms;

  &.checked {
    background: ${theme.colors.secondAccent};
    box-shadow: inset 0 0 0 1px #99cbec, 0 0 3px 2px rgba(153, 203, 236, 0.5);
  }
`;

interface Props {
  checked: boolean;
  label: React.ReactNode;
  onChange: (value: boolean) => void;
}

type OnChangeInternal = { onChangeInternal: () => void };

type CheckboxProps = Partial<Pick<Props, 'label' | 'onChange'>> & Omit<Props, 'label' | 'onChange'>;
type SimpleCheckboxProps = Pick<Props, 'checked'> & OnChangeInternal;
type LabeledCheckboxProps = Omit<Props, 'onChange'> & OnChangeInternal;

const SimpleCheckbox = ({ onChangeInternal, checked }: SimpleCheckboxProps) => (
  <Indicator onClick={onChangeInternal} className={cls({ checked: checked })} />
);

const LabeledCheckbox = ({ onChangeInternal, checked, label }: LabeledCheckboxProps) => {
  return (
    <Root onClick={onChangeInternal}>
      <Indicator className={cls({ checked: checked })} />
      <Label>{label}</Label>
    </Root>
  );
};

export const Checkbox = ({ checked, label, onChange }: CheckboxProps) => {
  const onChangeInternal = () => onChange?.(!checked);
  return label ? (
    <LabeledCheckbox label={label} onChangeInternal={onChangeInternal} checked={checked} />
  ) : (
    <SimpleCheckbox checked={checked} onChangeInternal={onChangeInternal} />
  );
};
