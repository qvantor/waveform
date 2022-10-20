import React from 'react';
import { mergeMap } from 'rxjs';
import { createRxModule, useNullableContext } from '@waveform/rxjs';
import { BehaviorSubject } from 'rxjs';
import { number } from '@waveform/math';

export class Wave extends BehaviorSubject<number[]> {
  setValue(index: number, value: number) {
    const newWave = [...this.value];
    newWave[index] = value;
    this.next(newWave);
  }
}

export const waveTableModule = () =>
  createRxModule({
    createContext: () => {
      const rateRange: [number, number] = [2, 7];
      const $rate = new BehaviorSubject<number>(4);
      const $waveTable = new BehaviorSubject<Wave[]>([
        new Wave(Array(number.powerOfTwo(rateRange[1])).fill(0)),
        new Wave(Array(number.powerOfTwo(rateRange[1])).fill(0)),
      ]);
      const $current = new BehaviorSubject<number>(0);

      const $wave = $current.pipe(mergeMap((value) => $waveTable.value[value]));

      return { $waveTable, $wave, $current, $rate, rateRange };
    },
    actions: ({ $waveTable, $current, $rate }) => ({
      updateCurrentWave: ([i, value]: [number, number]) => {
        $waveTable.value[$current.value].setValue(i, value);
      },
      setCurrent: (i: number) => $current.next(i),
      setRate: (value: number) => $rate.next(value),
    }),
  });

export type WaveTableModule = ReturnType<typeof waveTableModule>

export const WaveTableContext = React.createContext<WaveTableModule | null>(null);

export const useWaveTableModule = () => useNullableContext(WaveTableContext, 'useWaveTableContext');
