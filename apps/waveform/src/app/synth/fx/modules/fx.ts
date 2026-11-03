import { distinctUntilChanged, map, combineLatest, shareReplay } from 'rxjs';
import { isEqual, mapValues, omit } from 'lodash';
import {
  FX_MIX_PARAMS,
  FX_PARAMS,
  FX_TYPES,
  FxType,
  fxSnapSchema,
  MOD_SOURCES,
} from '@waveform/preset-schema';
import { ArrayBS, ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { SynthCoreModule } from '../../common/modules/synth-core';
import type { SynthModule } from '../../common/modules/synth';
import type { ModRoute, ModulationModule } from '../../common/modules/modulation';
import type { LfoModule, LfoRanges } from '../../common/modules/lfos';
import type { TransportModule } from '../../common/modules/transport';
import { fxRoute, lfoKnobRoutes, MOD_TARGETS } from '../../common/modulation/modulation-targets';
import { urlSnapshotPlugin } from '../../../app';
import { createFxSlot, FX_REGISTRY, FxSlot, FxStatus, isFxUsable } from '../effects';
import { FxModulation, FxNote, FxRoute, isLfoSource } from '../effects/fx-modulation';
import { createFxMod } from '../effects/fx-mod';
import { delayTime, delayTimeBounds } from '../effects/delay';
import { slotLines } from '../effects/fx-mod-params';

// the source VELO (MOD_SOURCES)
const VELO = MOD_SOURCES.indexOf('velo');

interface Dependencies {
  synthCore: SynthCoreModule;
  // the tempo (the delay in BPM)
  transport: TransportModule;
  // the envelopes of the last note, the LFOs and the routes the fx knobs follow
  synth: SynthModule;
  lfo: LfoModule;
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

// the bounds of the routes to the knobs of an effect at a tempo, by param: Time of the delay in BPM within its
// divisions (the others: the ranges of their knobs)
const fxBounds = (type: FxType, params: Record<string, number>, bpm: number) => {
  const time = type === 'delay' ? delayTimeBounds(params, bpm) : undefined;
  return time ? { time } : {};
};

// the routes to the knobs of an effect, in the units of its params (within `bounds`); an amount of 0 and a route
// switched off are left out. With a route of an LFO those of the note to the knobs of the LFOs too (within
// `lfoRanges` in BPM)
const fxRoutes = (
  routes: ModRoute[],
  type: FxType,
  lfoRanges: LfoRanges,
  bounds: Partial<Record<string, [number, number]>> = {}
): FxRoute[] => {
  const own = routes.flatMap((route) => {
    const definition = MOD_TARGETS[route.target];
    if (definition?.kind !== 'fx' || definition.fx !== type || route.amount === 0 || route.off) return [];
    return [fxRoute(definition.param, route, definition.scale, definition.range, bounds[definition.param])];
  });
  return own.some(({ source }) => isLfoSource(source)) ? [...own, ...lfoKnobRoutes(routes, lfoRanges)] : own;
};

// the note of an effect without its velocity unless a route of it reads VELO: a note of a legato phrase at
// another velocity changes nothing for the others
const withoutVelocity = (note: FxNote, routes: FxRoute[]): FxNote =>
  routes.some(({ source }) => source === VELO) ? note : omit(note, ['velo', 'velocity']);

// what an effect follows: nothing while it isn't active (in the chain, on and ready: a source is computed only
// for an effect that sounds) or has no route; no note yet (or paused): only the routes of the LFOs move it
export const fxModulation = (
  routes: FxRoute[],
  note: FxNote | null,
  active: boolean
): FxModulation | null => {
  if (!active || routes.length === 0) return null;
  if (!note) return routes.some(({ source }) => isLfoSource(source)) ? { note: null, routes } : null;
  return { note: withoutVelocity(note, routes), routes };
};

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
  transport: [{ $tempo }],
  lfo: [{ $state: $lfoState, $changes: $lfoChanges, $ranges: $lfoRanges }],
  modulation: [{ $routes }],
}: Dependencies) =>
  rxModel(() => {
    const $order = new ArrayBS<FxType[]>([...FX_TYPES]);
    const $effects = new ObjectBS<Record<FxType, FxState>>(defaultEffects());
    // the lines the knobs of the native nodes (the delay, the mix of every slot) follow their routes by
    const fxMod = createFxMod(audioCtx);
    const slots = Object.fromEntries(
      FX_TYPES.map((type, index) => [
        type,
        createFxSlot(audioCtx, FX_REGISTRY[type].create(audioCtx, fxMod), { fxMod, ...slotLines(index) }),
      ])
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
    // seconds between two echoes of the delay at most while it sounds (in the chain, on and ready: Time, in BPM
    // its division at the tempo, the top of the bounds of its routes, and its pan), 0 without it: the meters of the
    // output don't sleep between them
    const $echoGap = combineLatest([$effects, $status, $tempo, $routes]).pipe(
      map(([effects, status, bpm, routes]) => {
        const { added, on, params } = effects.delay;
        if (!added || !on || status.delay !== 'ready') return 0;
        const routed = fxRoutes(routes, 'delay', {}, fxBounds('delay', params, bpm)).find(
          ({ param }) => param === 'time'
        );
        return Math.max(delayTime(params, bpm), routed?.max ?? 0) + FX_PARAMS.delay.pan.max;
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return { $order, $effects, $status, $chain, $echoGap, slots, fxMod };
  })
    .actions(({ $order, $effects, $status, slots, fxMod }) => {
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
        retry: (type: FxType) => {
          slots[type].retry();
          fxMod.retry();
        },
        setOn: (type: FxType, on: boolean) => update(type, { on }),
        setMix: (type: FxType, mix: number) => update(type, { mix }),
        // a change of the user: with the params it sets at the tempo (the delay in BPM: paramChange)
        setParam: (type: FxType, key: string, value: number) => {
          const { params } = $effects.value[type];
          const change = FX_REGISTRY[type].paramChange?.(params, key, value, $tempo.value) ?? {
            [key]: value,
          };
          update(type, { params: { ...params, ...change } });
        },
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
    .subscriptions(({ $effects, $status, $chain, slots, fxMod }) => {
      // the LFOs as they are (every effect, its node made later takes them at once), then every state sent
      const lfoState = $lfoState.value;
      if (lfoState) {
        FX_TYPES.forEach((type) => slots[type].setLfos({ ...lfoState, instantly: true }));
        fxMod.setLfos({ ...lfoState, instantly: true });
      }
      return [
        // the tempo of the synth: an effect in BPM follows it
        $tempo.subscribe((bpm) => FX_TYPES.forEach((type) => slots[type].setTempo(bpm))),
        $lfoChanges.subscribe((state) => {
          FX_TYPES.forEach((type) => slots[type].setLfos(state));
          fxMod.setLfos(state);
        }),
        // the lines follow the last note and the routes of the note to the knobs of the LFOs
        $fxNote.pipe(distinctUntilChanged<FxNote | null>(isEqual)).subscribe((note) => fxMod.setNote(note)),
        combineLatest([$routes, $lfoRanges])
          .pipe(
            map(([routes, ranges]) => lfoKnobRoutes(routes, ranges)),
            distinctUntilChanged<FxRoute[]>(isEqual)
          )
          .subscribe((routes) => fxMod.setKnobRoutes(routes)),
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
          let prev:
            { mix: number; live: boolean; active: boolean; params: Record<string, number> } | undefined;
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
            combineLatest([$routes, $lfoRanges, $effects, $tempo]).pipe(
              map(([routes, ranges, effects, bpm]) =>
                fxRoutes(routes, type, ranges, fxBounds(type, effects[type].params, bpm))
              ),
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
      ];
    })
    .plugins(
      urlSnapshotPlugin({
        modelToSnap: ({ $order, $effects }) => ({
          o: $order.value,
          ...mapValues($effects.value, ({ added, on, mix, params }): FxSnap => ({
            a: added,
            on,
            mix,
            ...params,
          })),
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
    .destroy(({ slots, fxMod }) => {
      FX_TYPES.forEach((type) => slots[type].destroy());
      fxMod.destroy();
    });

export const { ModelProvider: FxProvider, useModel: useFx, Context: FxContext } = rxModelReact('fx', fx);

export type FxModule = ReturnType<typeof useFx>;
