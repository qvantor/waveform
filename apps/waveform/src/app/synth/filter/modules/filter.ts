import { merge, cloneDeep } from 'lodash';
import { map } from 'rxjs';
import { FilterRanges, FilterParams } from '@waveform/ui-kit';
import { ObjectBS, PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { SynthCoreModule } from '../../common/modules/synth-core';
import { urlSnapshotPlugin } from '../../../app';
import { defaultFilterRanges, filterRanges } from '../constants';

interface Dependencies {
  synthCore: SynthCoreModule;
}

const filter = ({ synthCore: [{ audioCtx }, { addMidNode, removeMidNode }] }: Dependencies) =>
  rxModel(() => {
    const filterNode = audioCtx.createBiquadFilter();
    const $active = new PrimitiveBS<boolean>(false);
    const $ranges = new ObjectBS<FilterRanges>(defaultFilterRanges);
    const $filterType = new PrimitiveBS<BiquadFilterType>('lowpass');
    const $filter = new ObjectBS({
      cutoff: 440,
      resonance: 0,
      gain: 1,
    });
    return { $active, $filter, $filterType, $ranges, filterNode };
  })
    .actions(({ $active, $filter, $filterType, $ranges }) => ({
      toggleActive: () => $active.next(!$active.value),

      setType: (type: BiquadFilterType) => $filterType.next(type),
      setNumericValue: (key: 'cutoff' | 'resonance' | 'gain', value: number) => {
        $filter.next({
          ...$filter.value,
          [key]: value,
        });
      },
      setFilterValues: (values: Omit<FilterParams, 'type'>) => $filter.next(values),

      setRanges: (ranges: FilterRanges) => $ranges.next(ranges),
    }))
    .subscriptions(
      ({ $active, $filter, $filterType, $ranges, filterNode }, { setRanges, setFilterValues }) => [
        $active.subscribe((value) => {
          if (value) addMidNode(filterNode);
          else removeMidNode(filterNode);
        }),
        $filterType.subscribe((type) => (filterNode.type = type)),
        $filter.subscribe((value) => {
          filterNode.frequency.setValueAtTime(value.cutoff, audioCtx.currentTime);
          filterNode.Q.setValueAtTime(value.resonance, audioCtx.currentTime);
          filterNode.gain.setValueAtTime(value.gain, audioCtx.currentTime);
        }),

        $filterType
          .pipe(
            map((type) => filterRanges[type]),
            map((ranges) => merge(cloneDeep(defaultFilterRanges), ranges))
          )
          .subscribe(setRanges),
        $ranges.pipe(map(() => $filter.value)).subscribe((filter) => {
          const { cutoff, resonance, gain } = $ranges.value;
          setFilterValues({
            cutoff: number.thresholds(filter.cutoff, cutoff.min, cutoff.max),
            resonance: number.thresholds(filter.resonance, resonance.min, resonance.max),
            gain: number.thresholds(filter.gain, gain.min, gain.max),
          });
        }),
      ]
    )
    .plugins(
      urlSnapshotPlugin({
        modelToSnap: ({ $active, $filterType, $filter }) => ({
          a: $active.value,
          t: $filterType.value,
          cut: $filter.value.cutoff,
          gain: $filter.value.gain,
          res: $filter.value.resonance,
        }),
        applySnap: (snap, { $active, $filterType, $filter }) => {
          snap.a && $active.next(snap.a);
          snap.t && $filterType.next(snap.t);
          $filter.next({
            cutoff: snap.cut ?? 440,
            resonance: snap.res ?? 0,
            gain: snap.gain ?? 1,
          });
        },
      })
    );
export const { ModelProvider: FilterProvider, useModel: useFilter } = rxModelReact('filter', filter);
