import React from 'react';
import { BehaviorSubject, combineLatest, distinctUntilChanged, map } from 'rxjs';
import { HandleModulation, HandleProps } from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { ENVELOPES, isLfo, MOD_SOURCES, ModSource } from '@waveform/preset-schema';
import { knobFull, ModRoute, ModulationContext, routesFull } from '../common/modules/modulation';
import { EnvelopesContext } from '../common/modules/envelopes';
import { SynthContext } from '../common/modules/synth';
import { SynthCoreContext } from '../common/modules/synth-core';
import { FxContext } from '../fx/modules/fx';
import { amountInUnits, MOD_TARGETS, ModScale } from '../common/modulation/modulation-targets';
import { LFO_SOURCE, noteLevel } from '../fx/effects/fx-modulation';
import { SOURCE_COLORS, SOURCE_LABELS } from '../envelope/envelope-colors';

const NO_ROUTES = new BehaviorSubject<ModRoute[]>([]);
const NOT_LIVE = new BehaviorSubject(false);
const LIVE = new BehaviorSubject(true);
// without the envelopes model (a spec of a section) the tab the model starts with
const FIRST_TAB = new BehaviorSubject<ModSource>(ENVELOPES[0]);

const sign = (value: number) => (value > 0 ? '+' : value < 0 ? '-' : '');

// the amount of a route in the units of its knob: octaves for a log one (+2.4 oct), a share of the range of a
// linear one or of the travel of a pow one (+35%)
export const formatAmount = (amount: number, scale: ModScale, range: [number, number]) =>
  scale === 'log'
    ? `${sign(amount)}${Math.abs(number.round(amountInUnits(amount, scale, range), 10))} oct`
    : `${sign(amount)}${Math.round(Math.abs(amount) * 100)}%`;

// the scale and the range of a knob whose amounts depend on its state (the knobs of the filter: the type)
interface KnobScale {
  scale: ModScale;
  range: [number, number];
}

// the modulation props of the knob of a target (modulation-targets.ts): the drop target of the tabs (none once
// the routes or the sources of the knob are full), the routes on it (a section of the amount dot each, the arc of
// the one of the selected tab, the dot changes it, Shift+Alt+click on the knob switches its polarity). Without the
// modulation model (a spec of a section) the knob has none
export type KnobModulation = Pick<HandleProps, 'modTarget' | 'modulations'>;

export const useKnobModulation = (target: string, knob?: KnobScale): KnobModulation => {
  const module = React.useContext(ModulationContext);
  const $routes = module?.[0].$routes ?? NO_ROUTES;
  const routes = useBehaviorSubject($routes);
  const actions = module?.[1];
  // the selected tab: only its route shows its arc on the knob and the dot changes it, every route moves the
  // mark
  const $selected = React.useContext(EnvelopesContext)?.[0].$selected ?? FIRST_TAB;
  const selected = useBehaviorSubject($selected);
  // the live mark of the knob (the sum of its routes): the level of each source in the last note (as the fx
  // follow it), while voices sound: only a knob with routes renders, when the first voice starts and the last
  // one ends. The knob of an effect an LFO moves moves without a note too (the LFOs of the fx run on their
  // clocks), while the effect is in the chain and on (else nothing moves it: without the fx model, a spec of a
  // section, always)
  const synth = React.useContext(SynthContext);
  const core = React.useContext(SynthCoreContext);
  const fx = React.useContext(FxContext)?.[0];
  const $voices = synth?.[0].$voicesCount;
  const own = routes.filter((route) => route.target === target);
  const routed = own.length > 0;
  const knobTarget = MOD_TARGETS[target];
  const effect = knobTarget?.kind === 'fx' && own.some(({ source }) => isLfo(source)) ? knobTarget.fx : null;
  const $live = React.useMemo(
    () =>
      effect && fx
        ? combineLatest([fx.$chain, fx.$effects]).pipe(
            map(([chain, effects]) => chain.includes(effect) && effects[effect].on),
            distinctUntilChanged()
          )
        : effect
        ? LIVE
        : $voices && routed
        ? $voices.pipe(
            map((count) => count > 0),
            distinctUntilChanged()
          )
        : NOT_LIVE,
    [$voices, routed, effect, fx]
  );
  const live = useObservable(
    $live,
    effect
      ? !fx || (fx.$effects.value[effect].added && fx.$effects.value[effect].on)
      : routed && ($voices?.value ?? 0) > 0
  );
  const level = React.useCallback(
    (source: ModSource) => () => {
      if (!synth || !core) return null;
      const { audioCtx } = core[0];
      const index = MOD_SOURCES.indexOf(source);
      if (index >= LFO_SOURCE) {
        return synth[0].noteLfos.level(index - LFO_SOURCE, audioCtx.currentTime * audioCtx.sampleRate);
      }
      const note = synth[0].$fxNote.value;
      if (!note) return null;
      return noteLevel(note, index, audioCtx.currentTime - note.start);
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
        : definition.kind === 'osc' || definition.kind === 'lfo'
        ? definition
        : undefined;
    // in the order of the sources: each has its section of the dot in the same place
    const modulations = routes
      .filter((route) => route.target === target)
      .sort((a, b) => MOD_SOURCES.indexOf(a.source) - MOD_SOURCES.indexOf(b.source))
      .map(
        ({ source, amount, bipolar }): HandleModulation => ({
          id: source,
          color: SOURCE_COLORS[source],
          amount,
          label: SOURCE_LABELS[source],
          onChange: (value) => actions?.setAmount(source, target, value),
          onRemove: () => actions?.removeRoute(source, target),
          formatAmount: units && ((value) => formatAmount(value, units.scale, units.range)),
          level: level(source),
          live,
          selected: source === selected,
          ...(bipolar && { bipolar }),
          onPolarity: (value) => actions?.setPolarity(source, target, value),
        })
      );
    const full = routesFull(routes) || knobFull(routes, target);
    return { modTarget: full ? undefined : target, modulations };
  }, [module, actions, routes, target, scale, min, max, level, live, selected]);
};
