import React from 'react';
import { FilterRouterProps } from '../types';
import { Lowpass } from './lowpass';

export const FilterRouter = ({ type, ...rest }: FilterRouterProps) => {
  switch (type) {
    case 'lowpass':
      return <Lowpass {...rest} />;
    default:
      return <>No controls for filter yet</>;
  }
};
