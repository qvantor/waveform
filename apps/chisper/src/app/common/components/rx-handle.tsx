import React from 'react';
import { Handle, HandleProps } from '@chisper/ui-kit';
import { PrimitiveBS, useBehaviorSubject } from '@chisper/rxjs-react';

type Props = Omit<HandleProps, 'value'> & {
  $value: PrimitiveBS<number>;
};

export const RxHandle = ({ $value, onChange, ...props }: Props) => {
  const value = useBehaviorSubject($value);
  const onChangeInternal = React.useCallback((newValue: number) => onChange?.(newValue), [onChange]);
  return <Handle {...props} value={value} onChange={onChangeInternal} />;
};
