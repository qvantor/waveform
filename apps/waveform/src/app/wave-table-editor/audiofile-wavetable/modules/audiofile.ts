import { map, mergeWith } from 'rxjs';
import { PrimitiveBS, ArrayBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { number, typedArray } from '@waveform/math';
import { AudiofileWavetableModule } from './audiofile-wavetable';

interface Props {
  audioBuffer: Float32Array;
}

interface Dependencies {
  audiofileWavetable: AudiofileWavetableModule;
}

const audiofileWavePicker = ({ audiofileWavetable: [, { setWaveTable }] }: Dependencies) =>
  rxModel(({ audioBuffer }: Props) => {
    const waveSizeRange = [2, 11];
    const pickersCountRange = [1, 64];

    const $phase = new PrimitiveBS<number>(0);
    const $waveSize = new PrimitiveBS<number>(9);
    const $wavesPickersCount = new PrimitiveBS<number>(32);
    const $wavePickers = new ArrayBS<number[]>([]);
    return {
      waveSizeRange,
      pickersCountRange,
      audioBuffer,
      $wavesPickersCount,
      $wavePickers,
      $waveSize,
      $phase,
    };
  })
    .actions(({ $wavePickers, $wavesPickersCount, $waveSize, $phase }) => ({
      setWavesPickers: (array: number[]) => $wavePickers.next(array),
      setWavesPickersCount: (value: number) => $wavesPickersCount.next(value),
      setWaveSize: (value: number) => $waveSize.next(value),
      setPhase: (value: number) => $phase.next(value),
    }))
    .subscriptions(
      ({ audioBuffer, $wavesPickersCount, $wavePickers, $waveSize, $phase }, { setWavesPickers }) => [
        // set wave-pickers on all audioBuffer length
        $wavesPickersCount
          .pipe(
            mergeWith($phase),
            map(() => {
              const pickersCount = $wavesPickersCount.value;
              const step = Math.floor(audioBuffer.length / pickersCount);

              const result: number[] = [];
              for (let i = 0; i < pickersCount; i++) {
                result.push(Math.round((i + $phase.value / 100) * step));
              }
              return result;
            })
          )
          .subscribe(setWavesPickers),

        // set pick wave for every wave-pickers and save to wavetable
        $wavePickers
          .pipe(
            mergeWith($waveSize),
            map(() => {
              const result: number[][] = [];
              const waveSize = number.powerOfTwo($waveSize.value);
              for (let i = 0; i < $wavePickers.value.length; i++) {
                const picker = $wavePickers.value[i];
                if (picker + waveSize > audioBuffer.length) continue;
                result[i] = typedArray.slice(audioBuffer, picker, waveSize);
              }
              return result;
            })
          )
          .subscribe(setWaveTable),
      ]
    );
export const { ModelProvider: AudiofileWavePickerProvider, useModel: useAudiofileWavePicker } = rxModelReact(
  'audiofileWavePicker',
  audiofileWavePicker
);
