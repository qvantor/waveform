import React from 'react';
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import styled from 'styled-components';
import { Vector2D } from '@waveform/math';
import { theme } from '../../common/constants';
import { useElementSize } from '../../common/hooks';
import { LineChartContext } from '../constants';
import { useLineChartContext } from '../hooks/use-line-chart-context';

type Props = {
  padding?: Vector2D;
  domainX?: [number, number];
  domainY?: [number, number];
  // HTML over the chart, in its context (the dot of a playing note)
  overlay?: React.ReactNode;
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;

const Root = styled.div`
  background: ${theme.colors.primaryDark};
  overflow: hidden;
  height: 100%;
  position: relative;
`;

const Svg = styled.svg`
  position: absolute;
  width: 100%;
  height: 100%;
`;

// an svg in the coordinates of the chart (from its padding): the chart's own under its overlay, another one in the
// overlay over what is drawn there
export const ChartSvg = ({ children }: React.PropsWithChildren) => {
  const {
    padding: [paddingX, paddingY],
  } = useLineChartContext();
  return (
    <Svg>
      <g transform={`translate(${paddingX}, ${paddingY})`}>{children}</g>
    </Svg>
  );
};

export const LineChart = ({
  padding = [5, 2],
  domainX: [domainXMin, domainXMax] = [0, 1],
  domainY: [domainYMin, domainYMax] = [0, 1],
  overlay,
  children,
  ...rest
}: React.PropsWithChildren<Props>) => {
  // observe the element itself: its size may change without a window resize (layout switch on rotation)
  const [ref, [width, height]] = useElementSize<HTMLDivElement>();
  const [paddingX, paddingY] = padding;

  const [scaleX, scaleY, lineFn] = React.useMemo(() => {
    const scaleX = scaleLinear([0, width - paddingX * 2]);
    const scaleY = scaleLinear([0, height - paddingY * 2]);
    scaleX.domain([domainXMin, domainXMax]);
    scaleY.domain([domainYMin, domainYMax]);

    const lineFn = line<number>()
      .x((d, i) => scaleX(i))
      .y(scaleY);

    return [scaleX, scaleY, lineFn];
  }, [width, height, paddingX, paddingY, domainXMin, domainXMax, domainYMin, domainYMax]);
  return (
    <LineChartContext.Provider value={{ width, height, padding, scaleX, scaleY, lineFn, ref }}>
      <Root {...rest} ref={ref}>
        {width !== 0 && (
          <>
            <ChartSvg>{children}</ChartSvg>
            {overlay}
          </>
        )}
      </Root>
    </LineChartContext.Provider>
  );
};
