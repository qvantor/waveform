import { map } from 'rxjs';
import { ArrayBS, rxModelReact } from '@waveform/rxjs-react';
import { wave } from '@waveform/math';
import { wavetable } from '../../common/modules';
import { AudioProcessorModule } from '../../wave-table-editor';

interface Dependencies {
  audioProcessor: AudioProcessorModule;
}

const audiofileWavetable = ({ audioProcessor: [, { setWave }] }: Dependencies) =>
  wavetable
    .actions(({ $waveTable, $current }) => ({
      setWaveTable: (waves: number[][]) => {
        if (waves.length - 1 < $current.value) {
          $current.next(waves.length - 1);
        }
        $waveTable.next(waves.map((wave) => new ArrayBS(wave)));
      },
    }))
    .subscriptions(({ $wave }) => $wave.pipe(map(wave.realWithImag)).subscribe(setWave));

export const { ModelProvider: AudiofileWavetableProvider, useModel: useAudiofileWavetable } = rxModelReact(
  'audiofileWavetable',
  audiofileWavetable
);

export type AudiofileWavetableModule = ReturnType<typeof useAudiofileWavetable>;
