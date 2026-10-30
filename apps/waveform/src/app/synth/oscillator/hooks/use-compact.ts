import { useElementSize } from '@waveform/ui-kit';

// px a strip of values of the oscillator takes at full size: those under the wave (up to 373 px, Wave 256/256), Oct,
// Semi and Fine over it; a narrower one (a phone, two oscillators side by side) has them smaller
const COMPACT_WIDTH = 380;

// a ref of an element as wide as the oscillator (the block of the wave) and whether it is narrower than at full
// size
export const useCompact = <T extends HTMLElement>() => {
  const [ref, [width]] = useElementSize<T>();
  return [ref, width > 0 && width < COMPACT_WIDTH] as const;
};
