import { mergeMap } from 'rxjs';
import { rxModel, ArrayBS, PrimitiveBS, rxModelReact } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { appSnapshotPlugin } from '../../../app';

// @todo make possible to save and load custom classes
export class Wave extends ArrayBS<number[]> {
  setValue(index: number, value: number) {
    const newWave = [...this.value];
    newWave[index] = value;
    this.next(newWave);
  }
}

const waveTable = () =>
  rxModel(() => {
    const rateRange: [number, number] = [2, 8];
    const $rate = new PrimitiveBS<number>(4);
    const $waveTable = new ArrayBS<ArrayBS<number[]>[]>([
      new ArrayBS(Array(number.powerOfTwo(rateRange[1])).fill(0)),
      new ArrayBS(Array(number.powerOfTwo(rateRange[1])).fill(0)),
    ]);
    const $current = new PrimitiveBS<number>(0);

    const $wave = $current.pipe(mergeMap((value) => $waveTable.value[value]));

    return { $waveTable, $wave, $current, $rate, rateRange };
  })
    .actions(({ $waveTable, $current, $rate }) => ({
      updateCurrentWave: ([i, value]: [number, number]) => {
        const $wave = $waveTable.value[$current.value];
        const newWave = [...$wave.value];
        newWave[i] = value;
        $wave.next(newWave);
      },
      setCurrent: (i: number) => $current.next(i),
      setRate: (value: number) => $rate.next(value),
      cloneCurrent: () => {
        $waveTable.next([...$waveTable.value, new ArrayBS([...$waveTable.value[$current.value].value])]);
      },
    }))
    .plugins(appSnapshotPlugin());

export const { ModelProvider: WaveTableProvider, useModel: useWaveTable } = rxModelReact(
  'waveTable',
  waveTable
);

export type WaveTableModel = ReturnType<typeof useWaveTable>;
