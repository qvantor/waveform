import { distinctUntilChanged, map, combineLatest, shareReplay } from 'rxjs';
import { isEqual, mapValues } from 'lodash';
import { FX_MIX_PARAM, FX_TYPES, FxType, fxSnapSchema } from '@waveform/preset-schema';
import { ArrayBS, ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { SynthCoreModule } from '../../common/modules/synth-core';
import { urlSnapshotPlugin } from '../../../app';
import { createFxSlot, FX_REGISTRY, FxSlot, FxStatus, isFxUsable } from '../effects';

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

// the added effects in the chain order; an unavailable one (unsupported or failed) stays added in the state,
// so a preset keeps it, but is left out of the chain
export const getChain = (
  order: FxType[],
  effects: Record<FxType, FxState>,
  status: Record<FxType, FxStatus>
) => order.filter((type) => effects[type].added && isFxUsable(status[type]));

export const fx = ({ synthCore: [{ audioCtx, fxIn, fxOut }] }: Dependencies) =>
  rxModel(() => {
    const $order = new ArrayBS<FxType[]>([...FX_TYPES]);
    const $effects = new ObjectBS<Record<FxType, FxState>>(defaultEffects());
    const slots = Object.fromEntries(
      FX_TYPES.map((type) => [type, createFxSlot(audioCtx, FX_REGISTRY[type].create(audioCtx))])
    ) as Record<FxType, FxSlot>;
    // mirrors the slot statuses (see the subscriptions)
    const $status = new ObjectBS<Record<FxType, FxStatus>>(
      mapValues(slots, (slot) => slot.$status.value) as Record<FxType, FxStatus>
    );
    const $chain = combineLatest([$order, $effects, $status]).pipe(
      map(([order, effects, status]) => getChain(order, effects, status)),
      distinctUntilChanged<FxType[]>(isEqual),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return { $order, $effects, $status, $chain, slots };
  })
    .actions(({ $order, $effects, $status, slots }) => {
      const update = (type: FxType, value: Partial<FxState>) =>
        $effects.next({ ...$effects.value, [type]: { ...$effects.value[type], ...value } });
      return {
        // an unsupported effect can't be added, a failed one loads again and is added (in the chain while it
        // loads, left out again if it fails)
        setAdded: (type: FxType, added: boolean) => {
          if (added && $status.value[type] === 'unsupported') return;
          if (added && $status.value[type] === 'failed') slots[type].retry();
          update(type, { added });
        },
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
    .subscriptions(({ $effects, $status, $chain, slots }) => [
      ...FX_TYPES.map((type) =>
        slots[type].$status.subscribe((status) => {
          if ($status.value[type] !== status) $status.next({ ...$status.value, [type]: status });
        })
      ),
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
          const { o, ...effects } = fxSnapSchema.parse(snap);
          $order.next(o);
          $effects.next(
            mapValues(effects, ({ a, on, mix, ...params }): FxState => ({ added: a, on, mix, params }))
          );
        },
      })
    )
    .destroy(({ slots }) => FX_TYPES.forEach((type) => slots[type].destroy()));

export const { ModelProvider: FxProvider, useModel: useFx } = rxModelReact('fx', fx);
