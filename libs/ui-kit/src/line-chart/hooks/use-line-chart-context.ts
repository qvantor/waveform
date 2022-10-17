import React from 'react';
import { LineChartContext } from '../constants';

export const useLineChartContext = () => {
  const context = React.useContext(LineChartContext);
  if (context === null) throw new Error('useLineChartContext should be used inside of LineChart component');
  return context;
};
