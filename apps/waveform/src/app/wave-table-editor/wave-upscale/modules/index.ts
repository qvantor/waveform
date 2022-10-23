import React from 'react';
import { createRxModule, useNullableContext } from '@waveform/rxjs';
import { BehaviorSubject, distinctUntilChanged, filter, map, mergeWith } from 'rxjs';
import { WaveTableModule } from '../../wave-table';
import { number } from '@waveform/math';
import { AudioProcessorModule } from '../../wave-table-editor';
import FFT from 'fft.js';

export const waveUpscaleModule = (
  { context: { $rate, $wave } }: WaveTableModule,
  { actions: { setWave } }: AudioProcessorModule
) =>
  createRxModule({
    createContext: () => {
      const $inputWave = new BehaviorSubject<number[]>([]);
      const $outputRate = new BehaviorSubject<number>(10);
      const $outputWave = new BehaviorSubject<[number[], number[]]>([[], []]);
      const $phase = new BehaviorSubject<number>(0);
      return { $outputRate, $outputWave, $inputWave, $phase };
    },
    subscriptions: ({ $inputWave, $outputRate, $phase, $outputWave }) => [
      $wave.subscribe($inputWave),
      $rate.pipe(filter((rate) => rate > $outputRate.value)).subscribe($outputRate),
      $inputWave
        .pipe(
          mergeWith($rate, $outputRate, $phase),
          distinctUntilChanged(),
          map(() => [...$inputWave.value].splice(0, number.powerOfTwo($rate.value))),
          map((croppedWave): number[] => {
            if ($rate.value >= $outputRate.value) return croppedWave;
            const fArray = [];
            for (let i = 0; i < number.powerOfTwo($rate.value); i++) {
              const from = croppedWave[i];
              const to = croppedWave[i + 1] ?? croppedWave[0];
              const stepsCount = number.powerOfTwo($outputRate.value) / number.powerOfTwo($rate.value);
              const diff = to - from;
              const stepDiff = diff / stepsCount;
              for (let j = 0; j < stepsCount; j++) {
                fArray.push(from + stepDiff * j);
              }
            }
            return [...fArray.splice(Math.round(($phase.value / 100) * fArray.length)), ...fArray];
          }),
          map((real): [number[], number[]] => {
            const f = new FFT(real.length);
            const imag = new Array(real.length);
            f.realTransform(imag, real);

            const imagOutput: number[] = [];
            for (let i = 0; i < imag.length; i++) {
              if (i % 2 === 0) continue;
              imagOutput.push(imag[i]);
            }
            return [real, imagOutput];
          })
        )
        .subscribe($outputWave),
      $outputWave.subscribe(setWave),
    ],
    actions: ({ $outputRate, $phase }) => ({
      setOutputRate: (value: number) => $outputRate.next(value),
      setPhase: (value: number) => $phase.next(value),
    }),
  });

export const WaveUpscaleContext = React.createContext<ReturnType<typeof waveUpscaleModule> | null>(null);

export const useWaveUpscale = () => useNullableContext(WaveUpscaleContext, 'useWaveUpscale');

// @todo return to it later
// const ModuleComponent = <ARGS, T, A>(module: (args: ARGS) => Module<T, A>) => {
//   const Context = React.createContext<Module<T, A> | null>(null);
//   const useHook = () => useNullableContext(Context);
//   const Component = (args: React.PropsWithChildren<ARGS>) => {
//     const value = useModuleCustom(module, args);
//     return <Context.Provider value={value}>{args.children}</Context.Provider>;
//     // return Context.Provider({ value, children: args.children });
//   };
//   return { useHook, Component };
// };
//
// export const { useHook: useWaveUpscale, Component: WaveUpscale } = ModuleComponent(waveUpscaleModule);
