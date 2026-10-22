import { distinctUntilChanged, map, combineLatest, shareReplay } from 'rxjs';
import { isEqual, mapValues } from 'lodash';
import { FX_MIX_PARAMS, FX_TYPES, FxType, fxSnapSchema, MOD_SOURCES } from '@waveform/preset-schema';
import { ArrayBS, ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { SynthCoreModule } from '../../common/modules/synth-core';
import type { SynthModule } from '../../common/modules/synth';
import type { ModRoute, ModulationModule } from '../../common/modules/modulation';
import { amountInUnits, MOD_TARGETS } from '../../common/modulation/modulation-targets';
import { urlSnapshotPlugin } from '../../../app';
import { createFxSlot, FX_REGISTRY, FxSlot, FxStatus, isFxUsable } from '../effects';
import type { FxModulation, FxNote, FxRoute } from '../effects/fx-modulation';

interface Dependencies {
  synthCore: SynthCoreModule;
  // the envelopes of the last note and the routes the fx knobs follow
  synth: SynthModule;
  modulation: ModulationModule;
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
  mix: FX_MIX_PARAMS[type].default,
  params: mapValues(FX_REGISTRY[type].params, (param) => param.default),
});

const defaultEffects = () =>
  Object.fromEntries(FX_TYPES.map((type) => [type, defaultFxState(type)])) as Record<FxType, FxState>;

// the routes to the knobs of an effect, in the units of its params; an amount of 0 is left out
const fxRoutes = (routes: ModRoute[], type: FxType): FxRoute[] =>
  routes.flatMap(({ source, target, amount }) => {
    const definition = MOD_TARGETS[target];
    if (definition?.kind !== 'fx' || definition.fx !== type || amount === 0) return [];
    const [min, max] = definition.range;
    const route: FxRoute = {
      param: definition.param,
      env: MOD_SOURCES.indexOf(source),
      amount: amountInUnits(amount, definition.scale, definition.range),
      min,
      max,
    };
    return [definition.scale === 'log' ? { ...route, log: true } : route];
  });

// what an effect follows: nothing while it isn't active (in the chain, on and ready: an envelope is computed
// only for an effect that sounds), has no route or no note was played yet
const fxModulation = (routes: FxRoute[], note: FxNote | null, active: boolean): FxModulation | null =>
  active && note && routes.length > 0 ? { note, routes } : null;

// the added effects in the chain order; an unavailable one (unsupported or failed) stays added in the state,
// so a preset keeps it, but is left out of the chain
export const getChain = (
  order: FxType[],
  effects: Record<FxType, FxState>,
  status: Record<FxType, FxStatus>
) => order.filter((type) => effects[type].added && isFxUsable(status[type]));

export const fx = ({
  synthCore: [{ audioCtx, fxIn, fxOut }],
  synth: [{ $fxNote }],
  modulation: [{ $routes }],
}: Dependencies) =>
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
        // loads, left out again if it fails); removing works whatever the status
        setAdded: (type: FxType, added: boolean) => {
          if (added && $status.value[type] === 'unsupported') return;
          if (added && $status.value[type] === 'failed') slots[type].retry();
          update(type, { added });
        },
        // loads a failed effect again, added or not (nothing to do in any other status)
        retry: (type: FxType) => slots[type].retry(),
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
        // every effect forgets its tail at once, in the chain or not (a preset switch: the output is muted, a
        // tail would play on with the params of the next preset)
        clear: () => FX_TYPES.forEach((type) => slots[type].clear()),
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
      // and only the changed values are applied (a knob drag sets one param per tick).
      // An effect that is not ready (loading, failed, unsupported) has no wet signal: its slot passes the dry
      // signal like a bypassed one and is inactive, so a loading effect isn't silent at mix 1 and an
      // unavailable one doesn't keep a tail
      ...FX_TYPES.map((type) => {
        let prev: { mix: number; live: boolean; active: boolean; params: Record<string, number> } | undefined;
        return combineLatest([
          $effects.pipe(
            map((effects) => effects[type]),
            distinctUntilChanged()
          ),
          $status.pipe(
            map((status) => status[type] === 'ready'),
            distinctUntilChanged()
          ),
        ]).subscribe(([{ added, mix, on, params }, ready]) => {
          const live = on && ready;
          const active = added && live;
          if (prev?.mix !== mix || prev?.live !== live) slots[type].setMix(mix, live);
          if (prev?.active !== active) slots[type].setActive(active);
          Object.entries(params).forEach(([key, value]) => {
            if (prev?.params[key] !== value) slots[type].setParam(key, value);
          });
          prev = { mix, live, active, params };
        });
      }),
      // the knobs follow the envelopes of the last note: each effect gets its routes and the note while it is
      // active, once per change
      ...FX_TYPES.map((type) =>
        combineLatest([
          $routes.pipe(
            map((routes) => fxRoutes(routes, type)),
            distinctUntilChanged<FxRoute[]>(isEqual)
          ),
          $fxNote.pipe(distinctUntilChanged<FxNote | null>(isEqual)),
          combineLatest([$effects, $status]).pipe(
            map(([effects, status]) => effects[type].added && effects[type].on && status[type] === 'ready'),
            distinctUntilChanged()
          ),
        ])
          .pipe(
            map(([routes, note, active]) => fxModulation(routes, note, active)),
            distinctUntilChanged<FxModulation | null>(isEqual)
          )
          .subscribe((mod) => slots[type].setModulation(mod))
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

export type FxModule = ReturnType<typeof useFx>;
