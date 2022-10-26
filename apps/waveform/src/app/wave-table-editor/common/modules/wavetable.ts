import { mergeMap } from 'rxjs';
import { ArrayBS, PrimitiveBS, rxModel } from '@waveform/rxjs-react';
import { number } from '@waveform/math';

export const wavetable = rxModel(() => {
  const rateRange: [number, number] = [2, 8];
  const $rate = new PrimitiveBS<number>(4);
  const $waveTable = new ArrayBS<ArrayBS<number[]>[]>([
    new ArrayBS(Array(number.powerOfTwo(rateRange[1])).fill(0)),
    new ArrayBS(Array(number.powerOfTwo(rateRange[1])).fill(0)),
  ]);
  const $current = new PrimitiveBS<number>(0);

  const $wave = $current.pipe(mergeMap((value) => $waveTable.value[value]));

  return { $waveTable, $wave, $current, $rate, rateRange };
}).actions(({ $current, $rate }) => ({
  setCurrent: (i: number) => $current.next(i),
  setRate: (value: number) => $rate.next(value),
}));

export type WavetableModel = ReturnType<typeof wavetable.init>[0];
export type WavetableActions = ReturnType<typeof wavetable.init>[1];
