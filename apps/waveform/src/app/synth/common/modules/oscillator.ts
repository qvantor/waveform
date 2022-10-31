import { ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { appSnapshotPlugin } from '../../../app';

const oscillator = () =>
  rxModel(() => {
    const ranges = {
      unison: [1, 8],
      detune: [0, 100],
      randPhase: [0, 0.005],
    };
    const $osc = new ObjectBS({
      unison: 4,
      detune: 30,
      randPhase: 0.001,
    });
    return {
      ranges,
      $osc,
    };
  })
    .actions(({ $osc }) => ({
      setOscValue: (key: keyof typeof $osc.value, value: number) =>
        $osc.next({
          ...$osc.value,
          [key]: value,
        }),
    }))
    .plugins(appSnapshotPlugin());

export const { ModelProvider: OscillatorProvider, useModel: useOscillator } = rxModelReact(
  'oscillator',
  oscillator
);

export type OscillatorModule = ReturnType<typeof useOscillator>;
export type OscillatorModel = OscillatorModule[0];
export type OscillatorActions = OscillatorModule[1];
