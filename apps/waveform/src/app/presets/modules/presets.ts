import { BehaviorSubject, debounceTime, defer, filter, of } from 'rxjs';
import toast from 'react-hot-toast';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { normalizePreset, presetHash, Preset, PresetListItem } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot, $snapshotChanges } from '../../app';
import { getPreset, getTopPresets, getUrlPresetId, setUrlPresetId } from '../services';

export interface CurrentPreset {
  id: string;
  name: string;
}

const currentHash = () => {
  try {
    return presetHash(getSnapshot());
  } catch (e) {
    return null;
  }
};

export const presets = () =>
  rxModel(() => {
    const $current = new BehaviorSubject<CurrentPreset | null>(null);
    const $loadedHash = new BehaviorSubject<string | null>(null);
    const $dirty = new PrimitiveBS<boolean>(false); // params were changed after the preset was loaded
    const $list = new BehaviorSubject<PresetListItem[]>([]); // list for ◀ ▶ (popular or the last search)
    // popular presets, loaded once on start for ◀ ▶ and the Popular tab; null until loaded
    const $top = new BehaviorSubject<PresetListItem[] | null>(null);
    const $topLoading = new PrimitiveBS<boolean>(false);
    return { $current, $loadedHash, $dirty, $list, $top, $topLoading };
  })
    .actions(({ $current, $loadedHash, $dirty, $list, $top, $topLoading }) => {
      const applyPreset = (preset: Preset) => {
        const data = normalizePreset(preset.data);
        applySnapshot(data);
        $current.next({ id: preset.id, name: preset.name });
        $loadedHash.next(presetHash(data));
        $dirty.next(false);
        setUrlPresetId(preset.id);
      };

      let lastRequest = 0;
      const loadById = async (id: string, errorMessage?: string) => {
        const request = ++lastRequest;
        try {
          const preset = await getPreset(id);
          // fast ◀ ▶ clicks: only the last requested preset is applied
          if (request === lastRequest) applyPreset(preset);
        } catch (e) {
          toast.error(errorMessage ?? (e instanceof Error ? e.message : 'Preset loading failed'));
        }
      };

      // parallel calls share one request; on failure $top stays null and the next call retries
      let topRequest: Promise<PresetListItem[] | null> | null = null;
      const loadTop = ({ silent = false } = {}) => {
        if (!topRequest) {
          $topLoading.next(true);
          topRequest = getTopPresets()
            .then((list) => {
              $top.next(list);
              return list;
            })
            .catch((e) => {
              if (!silent) toast.error(e instanceof Error ? e.message : 'Presets loading failed');
              return null;
            })
            .finally(() => {
              topRequest = null;
              $topLoading.next(false);
            });
        }
        return topRequest;
      };

      const step = async (direction: 1 | -1) => {
        // without a list (Init, a preset from the link) ◀ ▶ walk the popular presets
        if ($list.value.length === 0) {
          // clicks while loading are dropped
          if (topRequest) return;
          const top = $top.value ?? (await loadTop());
          if (top) $list.next(top);
        }
        const list = $list.value;
        if (list.length === 0) return;
        const index = list.findIndex(({ id }) => id === $current.value?.id);
        // not in the list: ▶ starts from the first (most popular), ◀ from the last
        const next =
          index === -1
            ? direction === 1
              ? 0
              : list.length - 1
            : (index + direction + list.length) % list.length;
        await loadById(list[next].id);
      };

      return {
        loadById,
        loadTop,
        next: () => step(1),
        prev: () => step(-1),
        setList: (list: PresetListItem[]) => $list.next(list),
        // the saved preset becomes current, current params are its params
        setSaved: (preset: CurrentPreset) => {
          $current.next(preset);
          $loadedHash.next(currentHash());
          $dirty.next(false);
          setUrlPresetId(preset.id);
        },
      };
    })
    .subscriptions(({ $loadedHash, $dirty }, { loadById, loadTop }) => [
      defer(() => loadTop({ silent: true })).subscribe(),
      $snapshotChanges
        .pipe(debounceTime(200))
        .subscribe(() => $dirty.next($loadedHash.value !== null && currentHash() !== $loadedHash.value)),
      of(getUrlPresetId())
        .pipe(filter((id): id is string => Boolean(id)))
        .subscribe((id) => loadById(id, 'Preset from the link was not found')),
    ]);

export const { ModelProvider: PresetsProvider, useModel: usePresets } = rxModelReact('presets', presets);
