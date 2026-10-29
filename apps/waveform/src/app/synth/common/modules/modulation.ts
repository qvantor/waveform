import { ArrayBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import {
  isLfo,
  isLfoKnob,
  MOD_KNOB_SOURCES_MAX,
  MOD_ROUTES_MAX,
  MOD_SOURCES,
  ModSource,
  ModValue,
} from '@waveform/preset-schema';
import { urlSnapshotPlugin } from '../../../app';
import { centered, isModTarget } from '../modulation/modulation-targets';

// a source (ENV 1–3, VELO, LFO 1–4) moves a knob (a target of modulation-targets.ts) by amount × its level: amount
// is a share of the range of the knob in its scale, -1..1; a bipolar route moves it around its value, amount ×
// (level - ½); one switched off (the menu of the knob) is kept with its amount and moves nothing
export interface ModRoute {
  source: ModSource;
  target: string;
  amount: number;
  bipolar?: boolean;
  off?: boolean;
}

// a route of `source` reads it (its dot shows the note): not one switched off (it still counts in the limits)
export const readsSource = (routes: ModRoute[], source: ModSource) =>
  routes.some((route) => route.source === source && !route.off);

// a route dropped on a knob: half its range, audible at once
export const DEFAULT_AMOUNT = 0.5;

// no route can be added (MOD_ROUTES_MAX): the knobs take no tab
export const routesFull = (routes: ModRoute[]) => routes.length >= MOD_ROUTES_MAX;
// the knob takes no other source (MOD_KNOB_SOURCES_MAX)
export const knobFull = (routes: ModRoute[], target: string) =>
  routes.filter((route) => route.target === target).length >= MOD_KNOB_SOURCES_MAX;
// a source can move the knob: a knob of the app, no LFO on a knob of an LFO
export const takesSource = (source: ModSource, target: string) =>
  isModTarget(target) && !(isLfo(source) && isLfoKnob(target));
// the first routes within the limits: of all of them and of each knob
const withinLimits = (routes: ModRoute[]) =>
  routes.reduce<ModRoute[]>(
    (kept, route) => (routesFull(kept) || knobFull(kept, route.target) ? kept : [...kept, route]),
    []
  );

const clampAmount = (amount: number) => Math.min(1, Math.max(-1, amount));
const routeKey = ({ source, target }: Pick<ModRoute, 'source' | 'target'>) => `${source}:${target}`;
const isSource = (value: string): value is ModSource => (MOD_SOURCES as readonly string[]).includes(value);
// a route of the snapshot: a uni one is its amount, a bipolar one { a, bi: true }, one switched off has off: true
const routeValue = ({ amount, bipolar, off }: ModRoute): ModValue =>
  bipolar || off ? { a: amount, ...(bipolar && { bi: true }), ...(off && { off: true }) } : amount;
const fromValue = (value: unknown): Pick<ModRoute, 'amount' | 'bipolar' | 'off'> | null => {
  if (typeof value === 'number') return { amount: clampAmount(value) };
  if (typeof value !== 'object' || value === null) return null;
  const { a, bi, off } = value as { a?: unknown; bi?: unknown; off?: unknown };
  if (typeof a !== 'number') return null;
  return {
    amount: clampAmount(a),
    ...(bi === true && { bipolar: true }),
    ...(off === true && { off: true }),
  };
};

// the routes of the modulation, one per source and knob; saved as { 'env2:osc1.wave': 0.5 }, a bipolar one as
// { 'lfo1:filter.gain': { a: 0.5, bi: true } }, one switched off as { a: 0.5, off: true } (snapshot mod)
export const modulation = () =>
  rxModel(() => {
    const $routes = new ArrayBS<ModRoute[]>([]);
    return { $routes };
  })
    .actions(({ $routes }) => {
      const find = (source: ModSource, target: string) =>
        $routes.value.find((route) => route.source === source && route.target === target);
      const update = (source: ModSource, target: string, change: (route: ModRoute) => ModRoute) =>
        $routes.next(
          $routes.value.map((route) =>
            route.source === source && route.target === target ? change(route) : route
          )
        );
      // a flag of a route: set, or left out of it
      const setFlag = (flag: 'bipolar' | 'off') => (source: ModSource, target: string, value: boolean) => {
        const route = find(source, target);
        if (!route || !!route[flag] === value) return;
        update(source, target, ({ [flag]: _, ...rest }) => (value ? { ...rest, [flag]: value } : rest));
      };
      return {
        // a source already on the knob keeps its amount, none is added past the limits; bipolar by default on a
        // knob centered on 0
        addRoute: (
          source: ModSource,
          target: string,
          amount = DEFAULT_AMOUNT,
          bipolar = centered(target)
        ) => {
          if (find(source, target) || !takesSource(source, target)) return;
          if (routesFull($routes.value) || knobFull($routes.value, target)) return;
          const route: ModRoute = { source, target, amount: clampAmount(amount) };
          $routes.next([...$routes.value, bipolar ? { ...route, bipolar } : route]);
        },
        setAmount: (source: ModSource, target: string, amount: number) => {
          if (!find(source, target)) return;
          update(source, target, (route) => ({ ...route, amount: clampAmount(amount) }));
        },
        // uni (up from the knob) or bipolar (around it)
        setPolarity: setFlag('bipolar'),
        // switched off a route keeps its amount and polarity, moving nothing
        setOff: setFlag('off'),
        removeRoute: (source: ModSource, target: string) =>
          $routes.next($routes.value.filter((route) => route.source !== source || route.target !== target)),
        // every route of a knob at once
        removeRoutes: (target: string) => {
          if (!$routes.value.some((route) => route.target === target)) return;
          $routes.next($routes.value.filter((route) => route.target !== target));
        },
      };
    })
    .plugins(
      urlSnapshotPlugin({
        modelToSnap: ({ $routes }) =>
          Object.fromEntries($routes.value.map((route) => [routeKey(route), routeValue(route)])) as Record<
            string,
            ModValue
          >,
        // a missing key is no route; an unknown source or knob (a newer preset), an LFO on a knob of an LFO and a
        // value that is neither an amount nor an object with one are left out, the routes past the limits too (an
        // edited url: the state stays one a preset can save)
        applySnap: (snap, { $routes }) =>
          $routes.next(
            withinLimits(
              Object.entries(snap).flatMap(([key, value]): ModRoute[] => {
                const [source, target] = key.split(':');
                const route = fromValue(value);
                if (!route || !isSource(source) || !target || !takesSource(source, target)) return [];
                return [{ source, target, ...route }];
              })
            )
          ),
      })
    );

export const {
  ModelProvider: ModulationProvider,
  useModel: useModulation,
  Context: ModulationContext,
} = rxModelReact('mod', modulation);

export type ModulationModule = ReturnType<typeof useModulation>;
