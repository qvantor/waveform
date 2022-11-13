import { ArrayBS, PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { OscillatorModule } from '../../../common/modules';

interface Dependencies {
  oscillator: OscillatorModule;
}

const manualWavetable = ({ oscillator: [{ $waveTable, $current }] }: Dependencies) =>
  rxModel(() => {
    const rateRange: [number, number] = [2, 8];
    const $rate = new PrimitiveBS<number>(4);

    return { $rate, rateRange };
  }).actions(({ $rate }) => ({
    updateCurrentWave: ([i, value]: [number, number]) => {
      const $wave = $waveTable.value[$current.value];
      const waveLength = $wave.value.length;
      const size = waveLength / number.powerOfTwo($rate.value);
      const from = (i / number.powerOfTwo($rate.value)) * $wave.value.length;

      const newWave = [...$wave.value];
      for (let i = from; i < from + size; i++) {
        newWave[i] = value;
      }
      $wave.next(newWave);
    },
    cloneCurrent: () => {
      $waveTable.next([...$waveTable.value, new ArrayBS([...$waveTable.value[$current.value].value])]);
    },
    setRate: (value: number) => $rate.next(value),
  }));

export const { ModelProvider: ManualWavetableProvider, useModel: useManualWavetable } = rxModelReact(
  'manualWavetable',
  manualWavetable
);

export type ManualWavetableModule = ReturnType<typeof useManualWavetable>;
export type ManualWavetableModel = ReturnType<ReturnType<typeof manualWavetable>['init']>[0];
export type ManualWavetableActions = ReturnType<ReturnType<typeof manualWavetable>['init']>[1];
