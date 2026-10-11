import React from 'react';
import styled from 'styled-components';
import { useElementSize } from '@waveform/ui-kit';

const Root = styled.div`
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: flex-start;
`;

const Frame = styled.div`
  position: relative;
  flex: none;
  overflow: hidden;
`;

const Inner = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
`;

interface Props {
  // layout width of the content before scaling
  width: number;
  // also shrink the content to fit the container height (otherwise the height follows the content)
  fitHeight?: boolean;
  className?: string;
}

// renders children at the given width and scales them down to fit the container
export const Scaled = ({ width, fitHeight = true, className, children }: React.PropsWithChildren<Props>) => {
  const [rootRef, [rootWidth, rootHeight]] = useElementSize<HTMLDivElement>();
  const [innerRef, [, innerHeight]] = useElementSize<HTMLDivElement>();
  const scale =
    innerHeight > 0 ? Math.min(1, rootWidth / width, fitHeight ? rootHeight / innerHeight : Infinity) : 0;
  return (
    <Root ref={rootRef} className={className}>
      <Frame style={{ width: width * scale, height: innerHeight * scale }}>
        <Inner ref={innerRef} style={{ width, transform: `scale(${scale})` }}>
          {children}
        </Inner>
      </Frame>
    </Root>
  );
};
