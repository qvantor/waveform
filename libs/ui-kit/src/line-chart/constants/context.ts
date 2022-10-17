import React from 'react';
import { ScaleLinear } from 'd3-scale';
import { Line } from 'd3-shape';
import { Vector2D } from '@waveform/math';

export interface LineChartContextType {
  width: number;
  height: number;
  scaleX: ScaleLinear<number, number>;
  scaleY: ScaleLinear<number, number>;
  lineFn: Line<number>;
  padding: Vector2D;
  ref: React.RefObject<HTMLDivElement>;
}

export const LineChartContext = React.createContext<LineChartContextType | null>(null);
