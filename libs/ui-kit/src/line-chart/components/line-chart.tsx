import React from 'react';
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import styled from 'styled-components';
import { Vector2D } from '@waveform/math';
import { theme } from '../../common/constants';
import { LineChartContext } from '../constants';

type Props = {
  padding?: Vector2D;
  domainX?: [number, number];
  domainY?: [number, number];
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

export const LineChart = ({
  padding = [5, 2],
  domainX,
  domainY,
  children,
  ...rest
}: React.PropsWithChildren<Props>) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [[width, height], setSize] = React.useState([0, 0]);

  React.useEffect(() => {
    const onResize = () => {
      if (!ref.current) return;
      setSize([ref.current.clientWidth, ref.current.clientHeight]);
    };
    onResize()
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
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
  }, [width, height, padding, domainX, domainY]);
  return (
    <LineChartContext.Provider value={{ width, height, padding, scaleX, scaleY, lineFn, ref }}>
      <Root {...rest} ref={ref}>
        {width !== 0 && (
          <Svg>
            <g transform={`translate(${padding[0]}, ${padding[1]})`}>{children}</g>
          </Svg>
        )}
      </Root>
    </LineChartContext.Provider>
  );
};
