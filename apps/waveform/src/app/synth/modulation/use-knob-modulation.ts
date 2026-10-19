import React from 'react';
import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';
import { HandleModulation, HandleProps } from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { EnvelopeId, ENVELOPES, MOD_SOURCES, ModSource } from '@waveform/preset-schema';
import { knobFull, ModRoute, ModulationContext, routesFull } from '../common/modules/modulation';
import { EnvelopesContext } from '../common/modules/envelopes';
import { SynthContext } from '../common/modules/synth';
import { SynthCoreContext } from '../common/modules/synth-core';
import { amountInUnits, MOD_TARGETS, ModScale } from '../common/modulation/modulation-targets';
import { noteLevel } from '../fx/effects/fx-modulation';
import { ENVELOPE_COLORS, ENVELOPE_LABELS } from '../envelope/envelope-colors';

const NO_ROUTES = new BehaviorSubject<ModRoute[]>([]);
const NOT_LIVE = new BehaviorSubject(false);
// without the envelopes model (a spec of a section) the tab the model starts with
const FIRST_TAB = new BehaviorSubject<EnvelopeId>(ENVELOPES[0]);

const sign = (value: number) => (value > 0 ? '+' : value < 0 ? '-' : '');

// the amount of a route in the units of its knob: octaves for a log one (+2.4 oct), a share of the range of a
// linear one (+35%)
export const formatAmount = (amount: number, scale: ModScale, range: [number, number]) =>
  scale === 'log'
    ? `${sign(amount)}${Math.abs(number.round(amountInUnits(amount, scale, range), 10))} oct`
    : `${sign(amount)}${Math.round(Math.abs(amount) * 100)}%`;

// the scale and the range of a knob whose amounts depend on its state (the knobs of the filter: the type)
interface KnobScale {
  scale: ModScale;
  range: [number, number];
}

// the modulation props of the knob of a target (modulation-targets.ts): the drop target of the ENV tabs (none
// once the routes or the sources of the knob are full), the routes on it (a section of the amount dot each, the
// arc of the one of the selected tab, the dot changes it). Without the modulation model (a spec of a section) the
// knob has none
export type KnobModulation = Pick<HandleProps, 'modTarget' | 'modulations'>;

export const useKnobModulation = (target: string, knob?: KnobScale): KnobModulation => {
  const module = React.useContext(ModulationContext);
  const $routes = module?.[0].$routes ?? NO_ROUTES;
  const routes = useBehaviorSubject($routes);
  const actions = module?.[1];
  // the selected ENV tab: only its route shows its arc on the knob and the dot changes it, every route moves the
  // mark
  const $selected = React.useContext(EnvelopesContext)?.[0].$selected ?? FIRST_TAB;
  const selected = useBehaviorSubject($selected);
  // the live mark of the knob (the sum of its routes): the level of each envelope in the last note (as the fx
  // follow it), while voices sound: only a knob with routes renders, when the first voice starts and the last
  // one ends
  const synth = React.useContext(SynthContext);
  const core = React.useContext(SynthCoreContext);
  const $voices = synth?.[0].$voicesCount;
  const routed = routes.some((route) => route.target === target);
  const $live = React.useMemo(
    () =>
      $voices && routed
        ? $voices.pipe(
            map((count) => count > 0),
            distinctUntilChanged()
          )
        : NOT_LIVE,
    [$voices, routed]
  );
  const live = useObservable($live, routed && ($voices?.value ?? 0) > 0);
  const level = React.useCallback(
    (source: ModSource) => () => {
      const note = synth?.[0].$fxNote.value;
      if (!note || !core) return null;
      return noteLevel(note, MOD_SOURCES.indexOf(source), core[0].audioCtx.currentTime - note.start);
    },
    [synth, core]
  );
  const scale = knob?.scale;
  const [min, max] = knob?.range ?? [];
  return React.useMemo(() => {
    const definition = MOD_TARGETS[target];
    if (!module || !definition) return {};
    const units: KnobScale | undefined =
      scale && min !== undefined && max !== undefined
        ? { scale, range: [min, max] }
        : definition.kind === 'osc'
        ? definition
        : undefined;
    // in the order of the sources: each has its section of the dot in the same place
    const modulations = routes
      .filter((route) => route.target === target)
      .sort((a, b) => MOD_SOURCES.indexOf(a.source) - MOD_SOURCES.indexOf(b.source))
      .map(
        ({ source, amount }): HandleModulation => ({
          id: source,
          color: ENVELOPE_COLORS[source],
          amount,
          label: ENVELOPE_LABELS[source],
          onChange: (value) => actions?.setAmount(source, target, value),
          onRemove: () => actions?.removeRoute(source, target),
          formatAmount: units && ((value) => formatAmount(value, units.scale, units.range)),
          level: level(source),
          live,
          selected: source === selected,
        })
      );
    const full = routesFull(routes) || knobFull(routes, target);
    return { modTarget: full ? undefined : target, modulations };
  }, [module, actions, routes, target, scale, min, max, level, live, selected]);
};
