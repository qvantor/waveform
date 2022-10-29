import React from 'react';
import { Line as LineType } from 'd3-shape';
import { theme } from '../../common/constants';
import { useLineChartContext } from '../hooks';

interface Props {
  data: number[];
  style?: React.CSSProperties;
}

interface CustomLineProps<T> {
  data: T[];
  customLineFn: LineType<T>;
  style?: React.CSSProperties;
}

export function Line(props: Props): JSX.Element;
export function Line<T>(props: CustomLineProps<T>): JSX.Element;

export function Line(props: Props | CustomLineProps<unknown>) {
  const { data, style } = props;
  const { lineFn } = useLineChartContext();
  const d = 'customLineFn' in props ? props.customLineFn(data) : lineFn(props.data);
  return (
    <g>
      <path
        style={{ stroke: theme.colors.accent, fill: 'transparent', strokeWidth: 2, ...style }}
        d={d ?? undefined}
      />
    </g>
  );
}
