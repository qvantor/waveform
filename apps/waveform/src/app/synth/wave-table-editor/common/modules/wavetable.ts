import { PrimitiveBS, rxModel } from '@waveform/rxjs-react';

// @todo $rate should be only part of manual wavetable
export const wavetable = rxModel(() => {
  const rateRange: [number, number] = [2, 8];
  const $rate = new PrimitiveBS<number>(4);

  return { rateRange, $rate };
}).actions(({ $rate }) => ({
  setRate: (value: number) => $rate.next(value),
}));

type WavetableInternal = ReturnType<typeof wavetable['init']>;
export type WavetableModule = [WavetableInternal[0], WavetableInternal[1]];
export type WavetableModel = WavetableInternal[0];
export type WavetableActions = WavetableInternal[1];
