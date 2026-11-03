import React from 'react';
import { styled } from 'styled-components';

// what the chart shows over the wave while a control is held (the phase, the voices of the unison): it fades out in
// OVERLAY_FADE ms once let go, then is not rendered at all (no work while the wave or the knobs move)

export const OVERLAY_FADE = 300;

// over the wave (the overlay of the chart), at the opacity of `visible`
export const FadeRoot = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: opacity ${OVERLAY_FADE}ms;
`;

// whether an overlay is rendered: while it is visible and while it fades out after
export const useFadeOut = (visible: boolean) => {
  const [shown, setShown] = React.useState(visible);
  React.useEffect(() => {
    if (visible) {
      setShown(true);
      return;
    }
    const timeout = setTimeout(() => setShown(false), OVERLAY_FADE);
    return () => clearTimeout(timeout);
  }, [visible]);
  return visible || shown;
};
