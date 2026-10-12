import { BehaviorSubject, debounceTime, filter, of } from 'rxjs';
import toast from 'react-hot-toast';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { normalizePreset, presetHash, Preset, PresetListItem } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot, $snapshotChanges } from '../../app';
import { getPreset, getUrlPresetId, setUrlPresetId } from '../services';

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
    return { $current, $loadedHash, $dirty, $list };
  })
    .actions(({ $current, $loadedHash, $dirty, $list }) => {
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

      const step = (direction: 1 | -1) => {
        const list = $list.value;
        if (list.length === 0) return;
        const index = list.findIndex(({ id }) => id === $current.value?.id);
        const next = index === -1 ? 0 : (index + direction + list.length) % list.length;
        loadById(list[next].id);
      };

      return {
        loadById,
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
    .subscriptions(({ $loadedHash, $dirty }, { loadById }) => [
      $snapshotChanges
        .pipe(debounceTime(200))
        .subscribe(() => $dirty.next($loadedHash.value !== null && currentHash() !== $loadedHash.value)),
      of(getUrlPresetId())
        .pipe(filter((id): id is string => Boolean(id)))
        .subscribe((id) => loadById(id, 'Preset from the link was not found')),
    ]);

export const { ModelProvider: PresetsProvider, useModel: usePresets } = rxModelReact('presets', presets);
