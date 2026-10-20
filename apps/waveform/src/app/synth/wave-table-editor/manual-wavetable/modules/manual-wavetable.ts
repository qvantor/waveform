import { ArrayBS, PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { OscillatorModule } from '../../../common/modules';
import { frameIndex } from '../../../common/modules/oscillator';
import { MAX_FRAMES } from '../../../common/wavetable/wavetable-mipmap';

interface Dependencies {
  oscillator: OscillatorModule;
}

// the editor works on the frame of the position (the nearest one)
export const manualWavetable = ({ oscillator: [{ $waveTable, $position, $morph }] }: Dependencies) =>
  rxModel(() => {
    const rateRange: [number, number] = [2, 8];
    const $rate = new PrimitiveBS<number>(4);

    return { $rate, rateRange };
  }).actions(({ $rate }) => ({
    updateCurrentWave: ([i, value]: [number, number]) => {
      const $wave = $waveTable.value[frameIndex($position.value, $waveTable.value.length, $morph.value)];
      const waveLength = $wave.value.length;
      const size = waveLength / number.powerOfTwo($rate.value);
      const from = (i / number.powerOfTwo($rate.value)) * $wave.value.length;

      const newWave = [...$wave.value];
      for (let i = from; i < from + size; i++) {
        newWave[i] = value;
      }
      $wave.next(newWave);
    },
    // a table holds MAX_FRAMES at most
    cloneCurrent: () => {
      if ($waveTable.value.length >= MAX_FRAMES) return;
      $waveTable.next([
        ...$waveTable.value,
        new ArrayBS([
          ...$waveTable.value[frameIndex($position.value, $waveTable.value.length, $morph.value)].value,
        ]),
      ]);
    },
    setRate: (value: number) => $rate.next(value),
  }));

export const { ModelProvider: ManualWavetableProvider, useModel: useManualWavetable } = rxModelReact(
  'manualWavetable',
  manualWavetable
);

export type ManualWavetableModel = ReturnType<ReturnType<typeof manualWavetable>['init']>[0];
export type ManualWavetableActions = ReturnType<ReturnType<typeof manualWavetable>['init']>[1];
