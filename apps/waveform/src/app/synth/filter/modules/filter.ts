import { combineLatest, distinctUntilChanged, map, Observable, shareReplay } from 'rxjs';
import { isEqual } from 'lodash';
import { FilterRanges, FilterParams } from '@waveform/ui-kit';
import { ObjectBS, PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { SynthCoreModule } from '../../common/modules/synth-core';
import type { VoiceFilterOptions } from '../../common/wavetable/voice-filter';
import { urlSnapshotPlugin } from '../../../app';
import { defaultFilterRanges, rangesOf } from '../constants';

interface Dependencies {
  synthCore: SynthCoreModule;
}

// the filter of the voices: each note filters its oscillators (voice-filter.ts), before its volume, so its
// envelopes move its own filter; the synth sends them $voiceFilter
export const filter = ({ synthCore: [{ audioCtx }] }: Dependencies) =>
  rxModel(() => {
    const { sampleRate } = audioCtx;
    const $active = new PrimitiveBS<boolean>(false);
    const $ranges = new ObjectBS<FilterRanges>(defaultFilterRanges);
    const $filterType = new PrimitiveBS<BiquadFilterType>('lowpass');
    const $filter = new ObjectBS({
      cutoff: 440,
      resonance: 0,
      gain: 1,
    });
    // what the voices play: the knobs of the filter, null while it is off
    const voiceFilter = (): VoiceFilterOptions | null =>
      $active.value ? { type: $filterType.value, ...$filter.value } : null;
    const $voiceFilter: Observable<VoiceFilterOptions | null> = combineLatest([
      $active,
      $filterType,
      $filter,
    ]).pipe(map(voiceFilter), distinctUntilChanged(isEqual), shareReplay({ bufferSize: 1, refCount: true }));
    return { $active, $filter, $filterType, $ranges, voiceFilter, $voiceFilter, sampleRate };
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
    .subscriptions(({ $filter, $filterType, $ranges }, { setRanges, setFilterValues }) => [
      $filterType.pipe(map(rangesOf)).subscribe(setRanges),
      $ranges.pipe(map(() => $filter.value)).subscribe((filter) => {
        const { cutoff, resonance, gain } = $ranges.value;
        setFilterValues({
          cutoff: number.thresholds(filter.cutoff, cutoff.min, cutoff.max),
          resonance: number.thresholds(filter.resonance, resonance.min, resonance.max),
          gain: number.thresholds(filter.gain, gain.min, gain.max),
        });
      }),
    ])
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
          snap.a !== undefined && $active.next(snap.a);
          $filter.next({
            cutoff: snap.cut ?? 440,
            resonance: snap.res ?? 0,
            gain: snap.gain ?? 1,
          });
          // type goes after values, so the new values are clamped by the type ranges
          $filterType.next(snap.t ?? $filterType.value);
        },
      })
    );
export const { ModelProvider: FilterProvider, useModel: useFilter } = rxModelReact('filter', filter);

export type FilterModule = ReturnType<typeof useFilter>;
