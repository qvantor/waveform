import { ArrayBS, rxModelReact } from '@waveform/rxjs-react';
import { OscillatorModule } from '../../../common/modules';
import { wavetable } from '../../common/modules';

interface Dependencies {
  oscillator: OscillatorModule;
}

const manualWavetable = ({ oscillator: [{ $waveTable, $current }] }: Dependencies) =>
  wavetable
    .actions(() => ({
    updateCurrentWave: ([i, value]: [number, number]) => {
      const $wave = $waveTable.value[$current.value];
      const newWave = [...$wave.value];
      newWave[i] = value;
      $wave.next(newWave);
    },
    cloneCurrent: () => {
      $waveTable.next([...$waveTable.value, new ArrayBS([...$waveTable.value[$current.value].value])]);
    },
  }));

export const { ModelProvider: ManualWavetableProvider, useModel: useManualWavetable } = rxModelReact(
  'manualWavetable',
  manualWavetable
);

export type ManualWavetableModule = ReturnType<typeof useManualWavetable>;
export type ManualWavetableModel = ReturnType<ReturnType<typeof manualWavetable>['init']>[0];
export type ManualWavetableActions = ReturnType<ReturnType<typeof manualWavetable>['init']>[1];
