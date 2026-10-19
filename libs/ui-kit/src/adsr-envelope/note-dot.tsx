import React from 'react';
import styled from 'styled-components';
import { Vector2D } from '@waveform/math';
import { useLineChartContext } from '../line-chart';

// the path of a note on the chart of its envelope: its corners [seconds after its start, seconds on the chart,
// level] (at least one), linear between them (two at the same time: a step), from `start` (ms on the document
// timeline, as performance.now()). Held, the dot stays on the last corner (the sustain); released, it is hidden
// after it
export interface NotePath {
  start: number;
  corners: [number, number, number][];
  held: boolean;
}

// a white dot of 3 px radius, slightly translucent
const RADIUS = 3;

const Dot = styled.div`
  position: absolute;
  left: ${-RADIUS}px;
  top: ${-RADIUS}px;
  width: ${RADIUS * 2}px;
  height: ${RADIUS * 2}px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.8);
  opacity: 0;
  pointer-events: none;
`;

// the keyframes of the dot along a path: each corner at its pixel in the chart (padding included) at its share
// of the path, the last one at 1 (a path of 0 s ends on its last corner, not on the style of the dot: hidden);
// the duration in ms
export const dotKeyframes = (
  { corners }: NotePath,
  scaleX: (value: number) => number,
  scaleY: (value: number) => number,
  [paddingX, paddingY]: Vector2D
) => {
  const length = corners[corners.length - 1][0];
  const keyframes = corners.map(
    ([time, x, level], i): Keyframe => ({
      offset: i === corners.length - 1 ? 1 : length > 0 ? time / length : 0,
      transform: `translate(${paddingX + scaleX(x)}px, ${paddingY + scaleY(level)}px)`,
      opacity: 1,
    })
  );
  return { keyframes, duration: length * 1000 };
};

// the dot of a note playing the envelope of the chart (null: none): a Web Animation of transform and opacity
// along its path, started at the start of the note. The compositor moves it, no frame runs on the main
// thread; on the sustain it is finished, after the release hidden. Made again only for a new path or new scales,
// not once its release is over (a longer release after it doesn't bring it back)
export const NoteDot = ({ path }: { path: NotePath | null }) => {
  const { scaleX, scaleY, padding } = useLineChartContext();
  const [paddingX, paddingY] = padding;
  const dot = React.useRef<HTMLDivElement>(null);
  // the last released note (its start) and the time its dot is hidden at, ms
  const released = React.useRef({ start: NaN, end: Infinity });
  React.useLayoutEffect(() => {
    const element = dot.current;
    // no Web Animations (jsdom): no dot
    if (!element || !path || !element.animate) return;
    const [length] = path.corners[path.corners.length - 1];
    if (!path.held) {
      const now = performance.now();
      // over by an earlier path of the note (its release made longer after it): it would come back
      if (released.current.start === path.start && released.current.end <= now) return;
      released.current = { start: path.start, end: path.start + length * 1000 };
      // over (a knob turned after it): it would be hidden at once
      if (released.current.end <= now) return;
    }
    const { keyframes, duration } = dotKeyframes(path, scaleX, scaleY, [paddingX, paddingY]);
    const animation = element.animate(keyframes, { duration, fill: path.held ? 'forwards' : 'none' });
    animation.startTime = path.start;
    return () => animation.cancel();
  }, [path, scaleX, scaleY, paddingX, paddingY]);
  return <Dot ref={dot} />;
};
