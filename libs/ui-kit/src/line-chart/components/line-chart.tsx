import React from 'react';
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import styled from 'styled-components';
import { Vector2D } from '@waveform/math';
import { theme } from '../../common/constants';
import { LineChartContext } from '../constants';

type Props = {
  height?: number;
  padding?: Vector2D;
  domainX?: [number, number];
  domainY?: [number, number];
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;

const Root = styled.div`
  background: ${theme.colors.primaryDark};
`;

export const LineChart = ({
  height = 300,
  padding = [5, 2],
  domainX,
  domainY,
  children,
  ...rest
}: React.PropsWithChildren<Props>) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(400);

  React.useEffect(() => {
    if (!ref.current) return;
    setWidth(ref.current.clientWidth);
  }, []);

  const [scaleX, scaleY, lineFn] = React.useMemo(() => {
    const scaleX = scaleLinear([0, width - padding[0] * 2]);
    const scaleY = scaleLinear([0, height - padding[1] * 2]);
    if (domainX) scaleX.domain(domainX);
    if (domainY) scaleY.domain(domainY);

    const lineFn = line<number>()
      .x((d, i) => scaleX(i))
      .y(scaleY);

    return [scaleX, scaleY, lineFn];
  }, [width, padding, height, domainX, domainY]);

  return (
    <LineChartContext.Provider value={{ width, height, padding, scaleX, scaleY, lineFn, ref }}>
      <Root style={{ height }} {...rest} ref={ref}>
        <svg style={{ width, height }}>
          <g transform={`translate(${padding[0]}, ${padding[1]})`}>{children}</g>
        </svg>
      </Root>
    </LineChartContext.Provider>
  );
};
