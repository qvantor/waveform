import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { act, renderHook } from '@testing-library/react';
import { createLfos, createModulation, createSynthCore } from '../../../test-utils/models';
import { LfoContext } from '../common/modules/lfos';
import { ModulationContext } from '../common/modules/modulation';
import { SynthContext, SynthModule } from '../common/modules/synth';
import { SynthCoreContext } from '../common/modules/synth-core';
import type { FxNote } from '../fx/effects/fx-modulation';
import { FxContext } from '../fx/modules/fx';
import { noteLfosOf } from './note-lfos';
import { useKnobModulation } from './use-knob-modulation';

const RATE = 48000;
const sine = (x: number) => (1 - Math.cos(2 * Math.PI * x)) / 2;

// the routes of a knob as they sound: the modulation and the LFO models, the last note of the synth and its
// voices, the clock of a core (moved by the spec)
const setup = () => {
  const modulation = createModulation();
  const lfos = createLfos(createSynthCore());
  const $fxNote = new BehaviorSubject<FxNote | null>(null);
  const $voicesCount = new BehaviorSubject(0);
  const noteLfos = noteLfosOf(RATE, lfos, $fxNote, modulation[0].$routes);
  noteLfos.follow();
  const synth = [{ $fxNote, $voicesCount, noteLfos: noteLfos.lfos }, {}] as unknown as SynthModule;
  const audioCtx = { currentTime: 0, sampleRate: RATE };
  const core = [{ audioCtx }, {}] as never;
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <SynthCoreContext.Provider value={core}>
      <SynthContext.Provider value={synth}>
        <LfoContext.Provider value={lfos}>
          <ModulationContext.Provider value={modulation}>{children}</ModulationContext.Provider>
        </LfoContext.Provider>
      </SynthContext.Provider>
    </SynthCoreContext.Provider>
  );
  const flat = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
  const play = (start: number) =>
    act(() => {
      $fxNote.next({ envelopes: [flat, flat, flat], start, release: null });
      $voicesCount.next(1);
    });
  return { modulation, lfos, audioCtx, play, wrapper, $voicesCount };
};

describe('useKnobModulation of the LFOs', () => {
  it('reads an LFO in the last note while voices sound: from its start (retrig)', () => {
    const { modulation, audioCtx, play, wrapper } = setup();
    act(() => modulation[1].addRoute('lfo1', 'osc1.wave'));
    const { result } = renderHook(() => useKnobModulation('osc1.wave'), { wrapper });
    expect(result.current.modulations?.[0]).toMatchObject({ id: 'lfo1', color: '#b73611', label: 'LFO 1' });
    expect(result.current.modulations?.[0].live).toBe(false);
    play(1);
    const [route] = result.current.modulations ?? [];
    expect(route.live).toBe(true);
    // a sine of 0.5 s an eighth of a second after the note on
    audioCtx.currentTime = 1.125;
    expect(route.level?.()).toBeCloseTo(sine(0.25), 5);
  });

  it('moves a knob of an effect without a note too: on the clock of the LFO', () => {
    const { modulation, lfos, audioCtx, wrapper } = setup();
    act(() => lfos[1].setMode('lfo2', 'free'));
    act(() => modulation[1].addRoute('lfo2', 'reverb.size'));
    const { result } = renderHook(() => useKnobModulation('reverb.size'), { wrapper });
    const [route] = result.current.modulations ?? [];
    expect(route.live).toBe(true);
    audioCtx.currentTime = 0.375;
    expect(route.level?.()).toBeCloseTo(sine(0.75), 5);
  });

  it('moves a knob of an effect only while the effect is in the chain and on', () => {
    const { modulation, wrapper: Inner } = setup();
    const $chain = new BehaviorSubject<string[]>(['reverb']);
    const $effects = new BehaviorSubject({ reverb: { added: true, on: true } });
    const fx = [{ $chain, $effects }, {}] as never;
    const wrapper = ({ children }: React.PropsWithChildren) => (
      <Inner>
        <FxContext.Provider value={fx}>{children}</FxContext.Provider>
      </Inner>
    );
    act(() => modulation[1].addRoute('lfo2', 'reverb.size'));
    const { result } = renderHook(() => useKnobModulation('reverb.size'), { wrapper });
    const live = () => result.current.modulations?.[0].live;
    expect(live()).toBe(true);
    act(() => $effects.next({ reverb: { added: true, on: false } }));
    expect(live()).toBe(false);
    act(() => {
      $effects.next({ reverb: { added: false, on: true } });
      $chain.next([]);
    });
    expect(live()).toBe(false);
  });

  it('a route of an LFO on a centered knob is bipolar, its polarity switches', () => {
    const { modulation, wrapper } = setup();
    act(() => modulation[1].addRoute('lfo3', 'filter.gain'));
    const { result } = renderHook(() => useKnobModulation('filter.gain'), { wrapper });
    expect(result.current.modulations?.[0].bipolar).toBe(true);
    act(() => result.current.modulations?.[0].onPolarity?.(false));
    expect(modulation[0].$routes.value[0]).toEqual({ source: 'lfo3', target: 'filter.gain', amount: 0.5 });
    expect(result.current.modulations?.[0].bipolar).toBeUndefined();
  });

  it('switches a route off and on: off it moves nothing, the knob is live by the routes on', () => {
    const { modulation, play, wrapper } = setup();
    act(() => {
      modulation[1].addRoute('lfo1', 'osc1.wave');
      modulation[1].setOff('lfo1', 'osc1.wave', true);
    });
    const { result } = renderHook(() => useKnobModulation('osc1.wave'), { wrapper });
    play(1);
    expect(result.current.modulations?.[0]).toMatchObject({ id: 'lfo1', off: true, live: false });
    act(() => result.current.modulations?.[0].onOff?.(false));
    expect(modulation[0].$routes.value[0]).toEqual({ source: 'lfo1', target: 'osc1.wave', amount: 0.5 });
    expect(result.current.modulations?.[0].off).toBeUndefined();
    expect(result.current.modulations?.[0].live).toBe(true);
  });

  it('removes every route of the knob at once, those of others stay', () => {
    const { modulation, wrapper } = setup();
    act(() => {
      modulation[1].addRoute('lfo1', 'osc1.wave');
      modulation[1].addRoute('env2', 'osc1.wave');
      modulation[1].addRoute('env2', 'osc1.gain');
    });
    const { result } = renderHook(() => useKnobModulation('osc1.wave'), { wrapper });
    act(() => result.current.onClearModulations?.());
    expect(result.current.modulations).toEqual([]);
    expect(modulation[0].$routes.value).toEqual([{ source: 'env2', target: 'osc1.gain', amount: 0.5 }]);
  });

  it('shows a route of an envelope on Rate in octaves of its frequency, on a time as a share of its travel', () => {
    const { modulation, wrapper } = setup();
    act(() => {
      modulation[1].addRoute('env2', 'lfo1.rate', 0.25);
      modulation[1].addRoute('env3', 'lfo1.delay', 0.25);
    });
    const rate = renderHook(() => useKnobModulation('lfo1.rate'), { wrapper }).result;
    const delay = renderHook(() => useKnobModulation('lfo1.delay'), { wrapper }).result;
    expect(rate.current.modulations?.[0].formatAmount?.(0.25)).toBe('+2.9 oct');
    expect(delay.current.modulations?.[0].formatAmount?.(0.25)).toBe('+25%');
  });

  it('shows a route on Pitch and on Fine as a share of the range of the knob, up from its value or around it', () => {
    const { modulation, wrapper } = setup();
    act(() => {
      modulation[1].addRoute('env2', 'osc1.pitch', 0.4);
      modulation[1].addRoute('lfo2', 'osc2.fine', -0.25);
    });
    const pitch = renderHook(() => useKnobModulation('osc1.pitch'), { wrapper }).result.current
      .modulations?.[0];
    const fine = renderHook(() => useKnobModulation('osc2.fine'), { wrapper }).result.current
      .modulations?.[0];
    expect([pitch?.amount, pitch?.bipolar, pitch?.formatAmount?.(0.4)]).toEqual([0.4, undefined, '+40%']);
    expect([fine?.amount, fine?.bipolar, fine?.formatAmount?.(-0.25)]).toEqual([-0.25, true, '-25%']);
  });
});
