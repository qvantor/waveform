import { distinctUntilChanged, map, combineLatest, shareReplay } from 'rxjs';
import { isEqual, isPlainObject, mapValues } from 'lodash';
import { FX_MIX_PARAM, FX_TYPES, FxType, normalizeFxOrder, ParamRange } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { ArrayBS, ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { SynthCoreModule } from '../../common/modules/synth-core';
import { urlSnapshotPlugin } from '../../../app';
import { createFxSlot, FX_REGISTRY, FxSlot } from '../effects';

interface Dependencies {
  synthCore: SynthCoreModule;
}

interface FxState {
  added: boolean; // in the chain and in the rack (left lamp)
  on: boolean; // not bypassed (rack switch)
  mix: number;
  params: Record<string, number>;
}

type FxSnap = { a: boolean; on: boolean; mix: number } & Record<string, number | boolean>;

const defaultFxState = (type: FxType): FxState => ({
  added: false,
  on: true,
  mix: FX_MIX_PARAM.default,
  params: mapValues(FX_REGISTRY[type].params, (param) => param.default),
});

const defaultEffects = () =>
  Object.fromEntries(FX_TYPES.map((type) => [type, defaultFxState(type)])) as Record<FxType, FxState>;

// the added effects in the chain order
export const getChain = (order: FxType[], effects: Record<FxType, FxState>) =>
  order.filter((type) => effects[type].added);

// legacy url params skip the preset schema: wrong types fall back to the default, numbers are clamped
// (and rounded for int params, the schema rejects fractions)
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const num = (value: unknown, { min, max, default: fallback, int }: ParamRange) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = number.thresholds(value, min, max);
  return int ? Math.round(clamped) : clamped;
};

export const fx = ({ synthCore: [{ audioCtx, fxIn, fxOut }] }: Dependencies) =>
  rxModel(() => {
    const $order = new ArrayBS<FxType[]>([...FX_TYPES]);
    const $effects = new ObjectBS<Record<FxType, FxState>>(defaultEffects());
    const slots = Object.fromEntries(
      FX_TYPES.map((type) => [type, createFxSlot(audioCtx, FX_REGISTRY[type].create(audioCtx))])
    ) as Record<FxType, FxSlot>;
    const $chain = combineLatest([$order, $effects]).pipe(
      map(([order, effects]) => getChain(order, effects)),
      distinctUntilChanged<FxType[]>(isEqual),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return { $order, $effects, $chain, slots };
  })
    .actions(({ $order, $effects }) => {
      const update = (type: FxType, value: Partial<FxState>) =>
        $effects.next({ ...$effects.value, [type]: { ...$effects.value[type], ...value } });
      return {
        setAdded: (type: FxType, added: boolean) => update(type, { added }),
        setOn: (type: FxType, on: boolean) => update(type, { on }),
        setMix: (type: FxType, mix: number) => update(type, { mix }),
        setParam: (type: FxType, key: string, value: number) =>
          update(type, { params: { ...$effects.value[type].params, [key]: value } }),
        // unknown id: nothing changes
        applyPreset: (type: FxType, id: string) => {
          const preset = FX_REGISTRY[type].presets.find((item) => item.id === id);
          if (preset) update(type, { mix: preset.mix, params: { ...preset.params } });
        },
        move: (from: number, to: number) => {
          const order = [...$order.value];
          const [type] = order.splice(from, 1);
          order.splice(to, 0, type);
          $order.next(order);
        },
      };
    })
    .subscriptions(({ $effects, $chain, slots }) => [
      // fxIn → added effects in order → fxOut
      $chain.subscribe((chain) => {
        fxIn.disconnect();
        FX_TYPES.forEach((type) => slots[type].output.disconnect());
        const nodes = [fxIn, ...chain.flatMap((type) => [slots[type].input, slots[type].output]), fxOut];
        for (let i = 0; i < nodes.length; i += 2) nodes[i].connect(nodes[i + 1]);
      }),
      // update() replaces only the changed effect's object, so the other slots are not touched,
      // and only the changed values are applied (a knob drag sets one param per tick)
      ...FX_TYPES.map((type) => {
        let prev: FxState | undefined;
        return $effects
          .pipe(
            map((effects) => effects[type]),
            distinctUntilChanged()
          )
          .subscribe((state) => {
            const { added, mix, on, params } = state;
            if (prev?.mix !== mix || prev?.on !== on) slots[type].setMix(mix, on);
            if (!prev || (prev.added && prev.on) !== (added && on)) slots[type].setActive(added && on);
            Object.entries(params).forEach(([key, value]) => {
              if (prev?.params[key] !== value) slots[type].setParam(key, value);
            });
            prev = state;
          });
      }),
    ])
    .plugins(
      urlSnapshotPlugin({
        modelToSnap: ({ $order, $effects }) => ({
          o: $order.value,
          ...mapValues(
            $effects.value,
            ({ added, on, mix, params }): FxSnap => ({ a: added, on, mix, ...params })
          ),
        }),
        applySnap: (snap, { $order, $effects }) => {
          $order.next(normalizeFxOrder(Array.isArray(snap.o) ? snap.o : []));
          $effects.next(
            Object.fromEntries(
              FX_TYPES.map((type) => {
                const defaults = defaultFxState(type);
                const value = (isPlainObject(snap[type]) ? snap[type] : {}) as Partial<FxSnap>;
                const state: FxState = {
                  added: bool(value.a, defaults.added),
                  on: bool(value.on, defaults.on),
                  mix: num(value.mix, FX_MIX_PARAM),
                  params: mapValues(FX_REGISTRY[type].params, (param, key) => num(value[key], param)),
                };
                return [type, state];
              })
            ) as Record<FxType, FxState>
          );
        },
      })
    )
    .destroy(({ slots }) => FX_TYPES.forEach((type) => slots[type].destroy()));

export const { ModelProvider: FxProvider, useModel: useFx } = rxModelReact('fx', fx);
