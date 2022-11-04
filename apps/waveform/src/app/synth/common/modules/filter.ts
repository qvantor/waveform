import { ObjectBS, PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { SynthCoreModule } from './synth-core';

interface Dependencies {
  synthCore: SynthCoreModule;
}

const filter = ({ synthCore: [{ audioCtx }, { addMidNode, removeMidNode }] }: Dependencies) =>
  rxModel(() => {
    const filterNode = audioCtx.createBiquadFilter();
    const $active = new PrimitiveBS<boolean>(false);
    const $filter = new ObjectBS({
      type: 'lowpass' as BiquadFilterType,
      cutoff: 440,
      resonance: 1,
      gain: 1,
    });
    return { $active, $filter, filterNode };
  })
    .actions(({ $active, $filter }) => ({
      toggleActive: () => $active.next(!$active.value),
      setType: (type: BiquadFilterType) => $filter.next({ ...$filter.value, type }),
      setNumericValue: (key: 'cutoff' | 'resonance' | 'gain', value: number) =>
        $filter.next({
          ...$filter.value,
          [key]: value,
        }),
    }))
    .subscriptions(({ $active, $filter, filterNode }) => [
      $active.subscribe((value) => {
        if (value) addMidNode(filterNode);
        else removeMidNode(filterNode);
      }),
      $filter.subscribe((value) => {
        filterNode.type = value.type;
        filterNode.frequency.setValueAtTime(value.cutoff, audioCtx.currentTime);
        filterNode.Q.setValueAtTime(value.resonance, audioCtx.currentTime);
        filterNode.gain.setValueAtTime(value.gain, audioCtx.currentTime);
      }),
    ]);

export const { ModelProvider: FilterProvider, useModel: useFilter } = rxModelReact('filter', filter);
