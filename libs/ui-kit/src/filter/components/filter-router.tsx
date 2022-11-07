import React from 'react';
import { FilterRouterProps } from '../types';
import { Lowpass } from './lowpass';
import { Highpass } from './highpass';
import { Bandpass } from './bandpass';

export const FilterRouter = ({ type, ...rest }: FilterRouterProps) => {
  switch (type) {
    case 'lowpass':
      return <Lowpass {...rest} />;
    case 'highpass':
      return <Highpass {...rest} />;
    case 'bandpass':
      return <Bandpass {...rest} />;
    default:
      return <>No controls for filter yet</>;
  }
};
