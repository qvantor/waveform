import { ArrayBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { MOD_KNOB_SOURCES_MAX, MOD_ROUTES_MAX, MOD_SOURCES, ModSource } from '@waveform/preset-schema';
import { urlSnapshotPlugin } from '../../../app';
import { isModTarget } from '../modulation/modulation-targets';

// a source (ENV 1–3) moves a knob (a target of modulation-targets.ts) by amount × its level: amount is a share
// of the range of the knob in its scale, -1..1
export interface ModRoute {
  source: ModSource;
  target: string;
  amount: number;
}

// a route dropped on a knob: half its range, audible at once
export const DEFAULT_AMOUNT = 0.5;

// no route can be added (MOD_ROUTES_MAX): the knobs take no ENV tab
export const routesFull = (routes: ModRoute[]) => routes.length >= MOD_ROUTES_MAX;
// the knob takes no other source (MOD_KNOB_SOURCES_MAX)
export const knobFull = (routes: ModRoute[], target: string) =>
  routes.filter((route) => route.target === target).length >= MOD_KNOB_SOURCES_MAX;
// the first routes within the limits: of all of them and of each knob
const withinLimits = (routes: ModRoute[]) =>
  routes.reduce<ModRoute[]>(
    (kept, route) => (routesFull(kept) || knobFull(kept, route.target) ? kept : [...kept, route]),
    []
  );

const clampAmount = (amount: number) => Math.min(1, Math.max(-1, amount));
const routeKey = ({ source, target }: Pick<ModRoute, 'source' | 'target'>) => `${source}:${target}`;
const isSource = (value: string): value is ModSource => (MOD_SOURCES as readonly string[]).includes(value);

// the routes of the modulation, one per source and knob; saved as { 'env2:osc1.wave': 0.5 } (snapshot mod)
export const modulation = () =>
  rxModel(() => {
    const $routes = new ArrayBS<ModRoute[]>([]);
    return { $routes };
  })
    .actions(({ $routes }) => {
      const find = (source: ModSource, target: string) =>
        $routes.value.find((route) => route.source === source && route.target === target);
      return {
        // a source already on the knob keeps its amount, none is added past the limits
        addRoute: (source: ModSource, target: string, amount = DEFAULT_AMOUNT) => {
          if (find(source, target) || !isModTarget(target)) return;
          if (routesFull($routes.value) || knobFull($routes.value, target)) return;
          $routes.next([...$routes.value, { source, target, amount: clampAmount(amount) }]);
        },
        setAmount: (source: ModSource, target: string, amount: number) => {
          if (!find(source, target)) return;
          $routes.next(
            $routes.value.map((route) =>
              route.source === source && route.target === target
                ? { ...route, amount: clampAmount(amount) }
                : route
            )
          );
        },
        removeRoute: (source: ModSource, target: string) =>
          $routes.next($routes.value.filter((route) => route.source !== source || route.target !== target)),
      };
    })
    .plugins(
      urlSnapshotPlugin({
        modelToSnap: ({ $routes }) =>
          Object.fromEntries($routes.value.map((route) => [routeKey(route), route.amount])) as Record<
            string,
            number
          >,
        // a missing key is no route; an unknown source or knob (a newer preset) is left out, the routes past
        // the limits too (an edited url: the state stays one a preset can save)
        applySnap: (snap, { $routes }) =>
          $routes.next(
            withinLimits(
              Object.entries(snap).flatMap(([key, amount]): ModRoute[] => {
                const [source, target] = key.split(':');
                if (typeof amount !== 'number' || !isSource(source) || !target || !isModTarget(target))
                  return [];
                return [{ source, target, amount: clampAmount(amount) }];
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
