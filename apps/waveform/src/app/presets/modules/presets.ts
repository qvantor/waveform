import { BehaviorSubject, debounceTime, defer } from 'rxjs';
import toast from 'react-hot-toast';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { normalizePreset, presetHash, Preset, PresetListItem } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot, $snapshotChanges } from '../../app';
import {
  clearUrlPresetId,
  getEditToken,
  getPreset,
  getTopPresets,
  getUrlPresetId,
  markPresetOpened,
  setUrlPresetId,
} from '../services';

export interface CurrentPreset {
  id: string;
  name: string;
  // opened on start without a choice of the user, its listens and stays are not counted (see usePresetUsageTracker);
  // not in the url: after a reload it would open from the link as chosen
  auto?: boolean;
}

const currentHash = () => {
  try {
    return presetHash(getSnapshot());
  } catch (e) {
    return null;
  }
};

// Init is the default sound: every missing key of a preset is its default
const INIT_HASH = presetHash({});
const isInit = () => currentHash() === INIT_HASH;

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
      // the current preset (null: Init) with the hash of its params, clean and in the url unless auto
      const setCurrent = (current: CurrentPreset | null, hash: string | null) => {
        $current.next(current);
        $loadedHash.next(hash);
        $dirty.next(false);
        if (current && !current.auto) setUrlPresetId(current.id);
        else clearUrlPresetId();
      };

      // opening own preset (saved from this browser) keeps it from the cleanup; the server counts days, so once
      // a session is enough, a failed request is sent again on the next opening
      const opened = new Set<string>();
      const markOpened = (id: string) => {
        const editToken = getEditToken(id);
        if (!editToken || opened.has(id)) return;
        opened.add(id);
        markPresetOpened(id, { editToken }).catch(() => opened.delete(id));
      };

      const applyPreset = (preset: Preset, auto = false) => {
        const data = normalizePreset(preset.data);
        applySnapshot(data);
        setCurrent({ id: preset.id, name: preset.name, ...(auto && { auto }) }, presetHash(data));
        markOpened(preset.id);
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
        // start without a link: a random popular preset, unless something was loaded, saved or changed meanwhile;
        // random, not the first: none of them is opened for every visitor; fails silently, the synth stays in Init
        openPopular: async () => {
          const start = lastRequest;
          const untouched = () => lastRequest === start && !$current.value && isInit();
          const top = await loadTop({ silent: true });
          if (!top?.length || !untouched()) return;
          const preset = await getPreset(top[Math.floor(Math.random() * top.length)].id).catch(() => null);
          if (preset && untouched()) applyPreset(preset, true);
        },
        next: () => step(1),
        prev: () => step(-1),
        setList: (list: PresetListItem[]) => $list.next(list),
        // the saved preset becomes current, current params are its params
        setSaved: (preset: CurrentPreset) => setCurrent(preset, currentHash()),
        // back to Init: the default sound without a preset
        reset: () => {
          lastRequest++; // a preset still loading is not applied over Init
          applySnapshot(normalizePreset({}));
          setCurrent(null, null);
        },
      };
    })
    .subscriptions(({ $loadedHash, $dirty }, { loadById, loadTop, openPopular }) => [
      defer(() => {
        const urlId = getUrlPresetId();
        // with a link only its preset opens, the popular list loads meanwhile for ◀ ▶
        return urlId
          ? Promise.all([loadTop({ silent: true }), loadById(urlId, 'Preset from the link was not found')])
          : openPopular();
      }).subscribe(),
      $snapshotChanges
        .pipe(debounceTime(200))
        .subscribe(() => $dirty.next($loadedHash.value !== null && currentHash() !== $loadedHash.value)),
    ]);

export const { ModelProvider: PresetsProvider, useModel: usePresets } = rxModelReact('presets', presets);
