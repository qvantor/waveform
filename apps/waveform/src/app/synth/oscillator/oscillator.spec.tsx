import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Handle, HandleProps } from '@waveform/ui-kit';
import { BehaviorSubject } from 'rxjs';
import { MOD_SOURCES, ModSource } from '@waveform/preset-schema';
import { createModulation, createOscillator } from '../../../test-utils/models';
import { ModulationContext } from '../common/modules/modulation';
import { MOD_TARGETS } from '../common/modulation/modulation-targets';
import { SynthContext, SynthModule } from '../common/modules/synth';
import { SynthCoreContext } from '../common/modules/synth-core';
import { withElementSize } from '../../../test-utils/element-size';
import { useOscillator1 } from '../common/modules';
import { useWavetables } from './hooks/use-wavetables';
import { Oscillator } from './index';

// the knobs are inspected by their props, RxHandle renders a Handle too
jest.mock('@waveform/ui-kit', () => ({
  ...jest.requireActual('@waveform/ui-kit'),
  Handle: jest.fn(() => null),
}));

jest.mock('./hooks/use-wavetables', () => ({
  ...jest.requireActual('./hooks/use-wavetables'),
  useWavetables: jest.fn(() => []),
}));

// the status over the wave needs the synth core, it has its own spec
jest.mock('./components/oscillator-status', () => ({ OscillatorStatus: () => null }));

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and
// the document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget, [clientX, clientY]: [number, number]) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

// presses a value and drags it by dx, dy (screen coordinates: y grows down)
const drag = (target: Element, [dx, dy]: [number, number]) => {
  pointer('pointerdown', target, [100, 100]);
  pointer('pointermove', document, [100 + dx, 100 + dy]);
  pointer('pointerup', document, [100 + dx, 100 + dy]);
};

const setup = ({ target }: { target?: 'osc1' | 'osc2' } = {}) => {
  const oscillator = createOscillator();
  const modulation = createModulation();
  const [model, actions] = oscillator;
  render(
    <ModulationContext.Provider value={modulation}>
      <Oscillator
        {...model}
        {...actions}
        useOscillator={(() => oscillator) as unknown as typeof useOscillator1}
        target={target}
      />
    </ModulationContext.Provider>
  );
  const knob = (label: string) =>
    (Handle as jest.Mock).mock.calls
      .map(([props]) => props as HandleProps)
      .filter((props) => props.label === label)
      .at(-1) as HandleProps;
  return { model, actions, knob, modulation };
};

describe('Oscillator', () => {
  afterEach(() => (Handle as jest.Mock).mockClear());

  describe('modulation', () => {
    it('Gain, Wave and Detune take the envelopes, with their own targets', () => {
      const { knob } = setup({ target: 'osc2' });
      expect(knob('Gain').modTarget).toBe('osc2.gain');
      expect(knob('Wave').modTarget).toBe('osc2.wave');
      expect(knob('Detune').modTarget).toBe('osc2.detune');
      expect(knob('Unison').modTarget).toBeUndefined();
    });

    it('with 64 routes the knobs take no envelope, their rings stay', () => {
      const { knob, modulation } = setup();
      const [{ $routes }, { addRoute }] = modulation;
      act(() =>
        MOD_SOURCES.forEach((source) =>
          Object.keys(MOD_TARGETS).forEach((target) => addRoute(source, target))
        )
      );
      expect($routes.value).toHaveLength(64);
      ['Gain', 'Wave', 'Detune'].forEach((label) => expect(knob(label).modTarget).toBeUndefined());
      expect(knob('Detune').modulations).toHaveLength(3);
    });

    it('a knob with 4 sources takes no other one, the others still do', () => {
      const { knob, modulation } = setup();
      const [{ $routes }] = modulation;
      // 4 sources there are not yet (the LFOs to come)
      act(() =>
        $routes.next(
          ['lfo1', 'lfo2', 'lfo3', 'lfo4'].map((source) => ({
            source: source as ModSource,
            target: 'osc1.detune',
            amount: 0.5,
          }))
        )
      );
      expect(knob('Detune').modTarget).toBeUndefined();
      expect(knob('Detune').modulations).toHaveLength(4);
      expect(knob('Gain').modTarget).toBe('osc1.gain');
    });

    it('a knob shows its routes in the colors of their envelopes, its rings change and remove them', () => {
      const { knob, modulation } = setup();
      const [{ $routes }, { addRoute }] = modulation;
      act(() => {
        addRoute('env2', 'osc1.detune');
        addRoute('env3', 'osc1.detune', -0.25);
        addRoute('env2', 'osc1.gain');
      });
      const [env2, env3] = knob('Detune').modulations ?? [];
      expect(env2).toMatchObject({ id: 'env2', amount: 0.5, color: '#f1c40f', label: 'ENV 2' });
      expect(env3).toMatchObject({ id: 'env3', amount: -0.25, label: 'ENV 3' });
      expect(env3.formatAmount?.(-0.25)).toBe('-25%');

      act(() => env2.onChange?.(0.8));
      act(() => env3.onRemove?.());
      expect($routes.value).toEqual([
        { source: 'env2', target: 'osc1.detune', amount: 0.8 },
        { source: 'env2', target: 'osc1.gain', amount: 0.5 },
      ]);
      expect(knob('Detune').modulations).toHaveLength(1);
    });

    it('the dot of a ring follows the envelope of the last note while voices sound', () => {
      const oscillator = createOscillator();
      const modulation = createModulation();
      const [model, actions] = oscillator;
      const decay = { attack: 0, hold: 0, decay: 1, sustain: 0, release: 0 };
      const flat = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
      const $fxNote = new BehaviorSubject<unknown>(null);
      const $voicesCount = new BehaviorSubject(0);
      const synth = [{ $fxNote, $voicesCount }, {}] as unknown as SynthModule;
      const audioCtx = { currentTime: 1.25 };
      render(
        <SynthCoreContext.Provider value={[{ audioCtx }, {}] as never}>
          <SynthContext.Provider value={synth}>
            <ModulationContext.Provider value={modulation}>
              <Oscillator
                {...model}
                {...actions}
                useOscillator={(() => oscillator) as unknown as typeof useOscillator1}
              />
            </ModulationContext.Provider>
          </SynthContext.Provider>
        </SynthCoreContext.Provider>
      );
      act(() => modulation[1].addRoute('env2', 'osc1.gain'));
      const gain = () =>
        (
          (Handle as jest.Mock).mock.calls
            .filter(([props]) => props.label === 'Gain')
            .at(-1)?.[0] as HandleProps
        ).modulations?.[0];
      expect(gain()?.live).toBe(false);
      expect(gain()?.level?.()).toBeNull();
      act(() => {
        $fxNote.next({ envelopes: [flat, decay, flat], start: 1, release: null });
        $voicesCount.next(1);
      });
      expect(gain()?.live).toBe(true);
      expect(gain()?.level?.()).toBeCloseTo(0.75);
    });
  });

  it('has the knobs of the unison group in order: Unison, Detune, Phase and Phase rand are under the wave', () => {
    setup();
    const labels = (Handle as jest.Mock).mock.calls.map(([props]) => (props as HandleProps).label);
    const group = labels.slice(labels.indexOf('Unison'), labels.indexOf('Unison') + 2);
    expect(group).toEqual(['Unison', 'Detune']);
    expect(labels).not.toContain('Phase');
    expect(labels).not.toContain('Phase rand');
    expect(useWavetables).toHaveBeenCalled();
  });

  it('shows Phase under the wave from 0 to 360 degrees, 180 by default, dragged right or up, around past an end', () => {
    const { model } = setup();
    const phase = screen.getByRole('slider', { name: 'Phase' });
    expect(phase.getAttribute('aria-valuetext')).toBe('180°');
    drag(phase, [50, 0]);
    expect(model.$osc.value.phase).toBe(0.75);
    expect(phase.getAttribute('aria-valuetext')).toBe('270°');
    drag(phase, [0, -50]);
    expect(model.$osc.value.phase).toBe(0);
    expect(phase.getAttribute('aria-valuetext')).toBe('0°');
    drag(phase, [-150, 0]);
    expect(model.$osc.value.phase).toBe(0.25);
    expect(phase.getAttribute('aria-valuetext')).toBe('90°');
  });

  it('shows Phase rand under the wave from 0 to 100% of the period, dragged left or down', () => {
    const { model } = setup();
    const phaseRand = screen.getByRole('slider', { name: 'Phase rand' });
    expect(phaseRand.getAttribute('aria-valuetext')).toBe('100%');
    drag(phaseRand, [0, 100]);
    expect(model.$osc.value.phaseRand).toBe(0.5);
    expect(phaseRand.getAttribute('aria-valuetext')).toBe('50%');
    drag(phaseRand, [-300, 0]);
    expect(model.$osc.value.phaseRand).toBe(0);
  });

  it('shows the frame of the Wave from 1 under the wave, of the frames of the table', () => {
    const { actions } = setup();
    expect(screen.getByText('1/1')).toBeDefined();
    act(() =>
      actions.setWaveTable([
        [0, 1, 0, -1],
        [1, 0, -1, 0],
        [0, -1, 0, 1],
      ])
    );
    act(() => actions.setPosition(2));
    expect(screen.getByText('3/3')).toBeDefined();
    act(() => actions.setPosition(1.37));
    expect(screen.getByText('2.4/3')).toBeDefined();
  });

  // the fade itself is in the spec of the overlay
  it('shows the phase over the wave while Phase or Phase rand is held, fades it out once let go', () => {
    const restore = withElementSize(200, 100);
    try {
      setup();
      const opacity = () => screen.getByTestId('phase-overlay').style.opacity;
      expect(screen.queryByTestId('phase-overlay')).toBeNull();
      pointer('pointerdown', screen.getByRole('slider', { name: 'Phase' }), [100, 100]);
      expect(opacity()).toBe('1');
      pointer('pointerup', document, [100, 100]);
      expect(opacity()).toBe('0');
      pointer('pointerdown', screen.getByRole('slider', { name: 'Phase rand' }), [100, 100]);
      expect(opacity()).toBe('1');
      pointer('pointerup', document, [100, 100]);
    } finally {
      restore();
    }
  });

  it('turns Wave by whole frames, labelled from 1', () => {
    const { knob, actions, model } = setup();
    act(() =>
      actions.setWaveTable([
        [0, 1, 0, -1],
        [1, 0, -1, 0],
        [0, -1, 0, 1],
      ])
    );
    expect(knob('Wave')).toMatchObject({ min: 0, max: 2, precision: 1 });
    expect(knob('Wave').formatValue?.(11)).toBe('12');
    expect(knob('Wave').formatValue?.(0)).toBe('1');
    act(() => knob('Wave').onChange?.(2));
    expect(model.$position.value).toBe(2);
    expect(knob('Wave').value).toBe(2);
  });

  it('labels a fractional Wave position of a preset with one decimal', () => {
    const { knob, actions } = setup();
    act(() => actions.setPosition(1.37));
    expect(knob('Wave').formatValue?.(1.37)).toBe('2.4');
  });
});
