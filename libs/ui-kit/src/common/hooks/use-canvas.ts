import React from 'react';
import { usePixelRatio } from './use-pixel-ratio';

const ORIGIN: readonly [number, number] = [0, 0];

// a canvas of width × height css px as sharp as the screen: the props of its element (its ref and its size in
// device pixels; a new size clears it) and `begin`, which clears it and gives its context in css px from `origin`,
// null without one
export const useCanvas = (width: number, height: number, [x, y]: readonly [number, number] = ORIGIN) => {
  const ratio = usePixelRatio();
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [pixelsX, pixelsY] = [Math.round(width * ratio), Math.round(height * ratio)];
  const begin = React.useCallback(() => {
    const context = ref.current?.getContext('2d');
    if (!context) return null;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelsX, pixelsY);
    context.setTransform(ratio, 0, 0, ratio, x * ratio, y * ratio);
    return context;
  }, [ratio, pixelsX, pixelsY, x, y]);
  return { canvas: { ref, width: pixelsX, height: pixelsY }, begin };
};
