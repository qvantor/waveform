import { distinctUntilChanged, map, combineLatest, shareReplay } from 'rxjs';
import { isEqual, isPlainObject, mapValues } from 'lodash';
import { FX_MIX_PARAM, FX_TYPES, FxType, ParamRange } from '@waveform/preset-schema';
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
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const num = (value: unknown, { min, max, default: fallback }: ParamRange) =>
  typeof value === 'number' && Number.isFinite(value) ? number.thresholds(value, min, max) : fallback;

// known types only, no duplicates, the missing ones are appended
const normalizeOrder = (order: unknown[]): FxType[] => {
  const known = order.filter(
    (type, i): type is FxType => FX_TYPES.includes(type as FxType) && order.indexOf(type) === i
  );
  return [...known, ...FX_TYPES.filter((type) => !known.includes(type))];
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
      // update() replaces only the changed effect's object, so the other slots are not touched
      ...FX_TYPES.map((type) =>
        $effects
          .pipe(
            map((effects) => effects[type]),
            distinctUntilChanged()
          )
          .subscribe(({ added, mix, on, params }) => {
            slots[type].setMix(mix, on);
            slots[type].setActive(added && on);
            Object.entries(params).forEach(([key, value]) => slots[type].setParam(key, value));
          })
      ),
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
          $order.next(normalizeOrder(Array.isArray(snap.o) ? snap.o : []));
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
