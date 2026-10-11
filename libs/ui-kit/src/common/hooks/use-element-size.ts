import React from 'react';
import { Vector2D } from '@waveform/math';

export const useElementSize = <T extends HTMLElement>() => {
  const ref = React.useRef<T>(null);
  const [size, setSize] = React.useState<Vector2D>([0, 0]);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((prev) => (prev[0] === width && prev[1] === height ? prev : [width, height]));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
};
