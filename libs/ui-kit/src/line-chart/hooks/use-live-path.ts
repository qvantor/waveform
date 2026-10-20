import React from 'react';

// the <path> of a chart drawn without a render (useLiveDraw) and the one writer of its d: the DOM gets only a d that
// changed (the browser styles, lays out and paints a path again for the same d, ~160 µs in Chrome; a step of a knob
// often moves no point of a chart by 0.1 px)
export const useLivePath = () => {
  const ref = React.useRef<SVGPathElement>(null);
  const written = React.useRef<string | null>(null);
  const write = React.useCallback((d: string) => {
    const path = ref.current;
    if (!path || d === written.current) return;
    written.current = d;
    path.setAttribute('d', d);
  }, []);
  return [ref, write] as const;
};
