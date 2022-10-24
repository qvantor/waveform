import { mergeMap } from 'rxjs';
import { rxModel, ArrayBS, PrimitiveBS, rxModelReact } from '@waveform/rxjs-react';
import { number } from '@waveform/math';

export class Wave extends ArrayBS<number[]> {
  setValue(index: number, value: number) {
    const newWave = [...this.value];
    newWave[index] = value;
    this.next(newWave);
  }
}

const waveTable = () =>
  rxModel(() => {
    const rateRange: [number, number] = [2, 7];
    const $rate = new PrimitiveBS<number>(4);
    const $waveTable = new ArrayBS<Wave[]>([
      new Wave(Array(number.powerOfTwo(rateRange[1])).fill(0)),
      new Wave(Array(number.powerOfTwo(rateRange[1])).fill(0)),
    ]);
    const $current = new PrimitiveBS<number>(0);

    const $wave = $current.pipe(mergeMap((value) => $waveTable.value[value]));

    return { $waveTable, $wave, $current, $rate, rateRange };
  }).actions(({ $waveTable, $current, $rate }) => ({
    updateCurrentWave: ([i, value]: [number, number]) => {
      $waveTable.value[$current.value].setValue(i, value);
    },
    setCurrent: (i: number) => $current.next(i),
    setRate: (value: number) => $rate.next(value),
  }));

export const { ModelProvider: WaveTableProvider, useModel: useWaveTable } = rxModelReact('waveTable', waveTable);

export type WaveTableModel = ReturnType<typeof useWaveTable>
