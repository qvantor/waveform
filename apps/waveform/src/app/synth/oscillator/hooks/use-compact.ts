import { useElementSize } from '@waveform/ui-kit';

// px a row of the oscillator takes at full size: its values under the wave (up to 373 px, Wave 256/256), Oct, Semi,
// Fine and the name of a table; a narrower one (a phone, two oscillators side by side) has them smaller
const COMPACT_WIDTH = 380;

// a ref of a row as wide as the oscillator and whether it is narrower than at full size
export const useCompact = <T extends HTMLElement>() => {
  const [ref, [width]] = useElementSize<T>();
  return [ref, width > 0 && width < COMPACT_WIDTH] as const;
};
