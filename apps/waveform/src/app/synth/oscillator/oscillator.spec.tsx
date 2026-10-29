import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Handle, HandleProps } from '@waveform/ui-kit';
import { BehaviorSubject } from 'rxjs';
import { MOD_SOURCES } from '@waveform/preset-schema';
import { withElementSize } from '@waveform/ui-kit/test-utils';
import { createEnvelopes, createModulation, createOscillator } from '../../../test-utils/models';
import { ModulationContext } from '../common/modules/modulation';
import { EnvelopesContext } from '../common/modules/envelopes';
import { MOD_TARGETS } from '../common/modulation/modulation-targets';
import { SynthContext, SynthModule } from '../common/modules/synth';
import { SynthCoreContext } from '../common/modules/synth-core';
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

const setup = ({
  target,
  envelopes = null,
}: { target?: 'osc1' | 'osc2'; envelopes?: ReturnType<typeof createEnvelopes> | null } = {}) => {
  const oscillator = createOscillator();
  const modulation = createModulation();
  const [model, actions] = oscillator;
  render(
    <EnvelopesContext.Provider value={envelopes}>
      <ModulationContext.Provider value={modulation}>
        <Oscillator
          {...model}
          {...actions}
          useOscillator={(() => oscillator) as unknown as typeof useOscillator1}
          target={target}
        />
      </ModulationContext.Provider>
    </EnvelopesContext.Provider>
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
    });

    it('with 64 routes the knobs take no envelope, their routes stay', () => {
      const { knob, modulation } = setup();
      const [{ $routes }, { addRoute }] = modulation;
      act(() => {
        (['env1', 'env2', 'env3'] as const).forEach((source) => addRoute(source, 'osc1.detune'));
        MOD_SOURCES.forEach((source) =>
          Object.keys(MOD_TARGETS).forEach((target) => addRoute(source, target))
        );
      });
      expect($routes.value).toHaveLength(64);
      ['Gain', 'Wave', 'Detune'].forEach((label) => expect(knob(label).modTarget).toBeUndefined());
      expect(knob('Detune').modulations).toHaveLength(3);
    });

    it('a knob with 4 sources takes no other one, the others still do', () => {
      const { knob, modulation } = setup();
      const [, { addRoute }] = modulation;
      act(() =>
        (['lfo1', 'lfo2', 'lfo3', 'lfo4'] as const).forEach((source) => addRoute(source, 'osc1.detune'))
      );
      expect(knob('Detune').modTarget).toBeUndefined();
      expect(knob('Detune').modulations).toHaveLength(4);
      expect(knob('Gain').modTarget).toBe('osc1.gain');
    });

    it('a knob shows its routes in the colors of their envelopes, its dot changes and removes them', () => {
      const { knob, modulation } = setup();
      const [{ $routes }, { addRoute }] = modulation;
      act(() => {
        addRoute('env2', 'osc1.detune');
        addRoute('env3', 'osc1.detune', -0.25);
        addRoute('env2', 'osc1.gain');
      });
      const [env2, env3] = knob('Detune').modulations ?? [];
      expect(env2).toMatchObject({ id: 'env2', amount: 0.5, color: '#1663c7', label: 'ENV 2' });
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

    it('gives the routes of a knob in the order of the sources: each has its section of the dot in one place', () => {
      const { knob, modulation } = setup();
      act(() => {
        modulation[1].addRoute('env3', 'osc1.detune');
        modulation[1].addRoute('env1', 'osc1.detune');
        modulation[1].addRoute('env2', 'osc1.detune');
      });
      expect(knob('Detune').modulations?.map(({ id }) => id)).toEqual(['env1', 'env2', 'env3']);
    });

    it('the route of the selected ENV tab is the one the knob shows, ENV 1 without the envelopes model', () => {
      const selected = (knob: (label: string) => HandleProps) =>
        knob('Detune').modulations?.map(({ id, selected }) => [id, selected]);
      const routes = ({ addRoute }: ReturnType<typeof createModulation>[1]) =>
        act(() => {
          addRoute('env1', 'osc1.detune');
          addRoute('env2', 'osc1.detune');
        });

      const alone = setup();
      routes(alone.modulation[1]);
      expect(selected(alone.knob)).toEqual([
        ['env1', true],
        ['env2', false],
      ]);
      (Handle as jest.Mock).mockClear();

      const envelopes = createEnvelopes();
      const { knob, modulation } = setup({ envelopes });
      routes(modulation[1]);
      act(() => envelopes[1].select('env2'));
      expect(selected(knob)).toEqual([
        ['env1', false],
        ['env2', true],
      ]);
    });

    // the oscillator with the synth: its last note and the count of its voices
    const setupWithSynth = () => {
      const oscillator = createOscillator();
      const modulation = createModulation();
      const [model, actions] = oscillator;
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
      return { modulation, $fxNote, $voicesCount };
    };

    it('renders on the voices only with routes: when the first one starts and the last one ends', () => {
      const { modulation, $voicesCount } = setupWithSynth();
      // whether the knobs rendered when the synth had `count` voices
      const rendered = (count: number) => {
        const before = (Handle as jest.Mock).mock.calls.length;
        act(() => $voicesCount.next(count));
        return (Handle as jest.Mock).mock.calls.length > before;
      };
      expect([1, 2, 0].map(rendered)).toEqual([false, false, false]);
      act(() => modulation[1].addRoute('env2', 'osc1.gain'));
      expect([1, 2, 3, 1, 0, 1].map(rendered)).toEqual([true, false, false, false, true, true]);
    });

    it('the level of a route follows the envelope of the last note while voices sound', () => {
      const { modulation, $fxNote, $voicesCount } = setupWithSynth();
      const decay = { attack: 0, hold: 0, decay: 1, sustain: 0, release: 0 };
      const flat = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
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

  it('has the knobs Gain, Wave and Detune: Oct, Semi and Fine are over the wave, Phase, Phase rand and Unison under it', () => {
    setup();
    const labels = (Handle as jest.Mock).mock.calls.map(([props]) => (props as HandleProps).label);
    expect([...new Set(labels)]).toEqual(['Gain', 'Wave', 'Detune']);
    const sliders = screen.getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'));
    expect(sliders).toEqual(['Oct', 'Semi', 'Fine', 'Phase', 'Phase rand', 'Unison']);
    expect(useWavetables).toHaveBeenCalled();
  });

  it('has Oct, Semi and Fine in a strip on top of the block of the wave, the table over the block', () => {
    setup();
    const strip = screen.getByRole('slider', { name: 'Semi' }).parentElement as HTMLElement;
    const block = strip.parentElement as HTMLElement;
    expect(block.firstElementChild).toBe(strip);
    expect(block.lastElementChild).toBe(screen.getByRole('slider', { name: 'Unison' }).parentElement);
    const table = screen.getByText('Loading...');
    expect(block.contains(table)).toBe(false);
    expect(table.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has Oct, Semi and Fine dragged up or right by whole octaves, semitones and cents (2 px each)', () => {
    const { model } = setup();
    const field = (name: string) => screen.getByRole('slider', { name });
    drag(field('Semi'), [0, -70]);
    drag(field('Fine'), [0, -14]);
    expect(model.$osc.value).toMatchObject({ octave: 0, semi: 7, fine: 7 });
    expect(model.$params.value.detune).toBe(707);
    drag(field('Fine'), [0, 28]);
    drag(field('Oct'), [10, 0]);
    drag(field('Semi'), [0, 500]);
    expect(model.$osc.value).toMatchObject({ octave: 1, semi: -12, fine: -7 });
    expect(field('Semi').getAttribute('aria-valuetext')).toBe('-12');
  });

  it('Semi takes the routes of Pitch, Fine those of Fine; Oct none', () => {
    const { modulation } = setup({ target: 'osc2' });
    const targets = () =>
      Array.from(document.querySelectorAll('[data-mod-target]')).map((element) =>
        element.getAttribute('data-mod-target')
      );
    expect(targets()).toEqual(expect.arrayContaining(['osc2.pitch', 'osc2.fine']));
    const field = (name: string) => screen.getByRole('slider', { name });
    expect(field('Oct').hasAttribute('data-mod-target')).toBe(false);
    expect(field('Oct').querySelector('[data-testid="mod-track"]')).toBeNull();
    act(() => modulation[1].addRoute('env1', 'osc2.pitch', 7 / 48));
    // the dot of the selected tab (ENV 1 without the envelopes model) in the cell of Semi: its amount in semitones
    const dot = screen.getByRole('slider', { name: 'ENV 1' });
    expect(field('Semi').contains(dot)).toBe(true);
    act(() => modulation[1].addRoute('env1', 'osc2.fine', 0.25));
    expect(screen.getAllByTestId('mod-bar')).toHaveLength(2);
  });

  it('shows a route of Pitch on the range of Semi, of Fine on the range of Fine, from the value', () => {
    const { modulation, actions } = setup();
    act(() => {
      actions.setOscValue('semi', 6);
      modulation[1].addRoute('env1', 'osc1.pitch', 6 / 48);
      modulation[1].addRoute('env1', 'osc1.fine', 0.5);
    });
    // +6 of the 24 semitones of Semi from +6 (three quarters); +50 of the 200 cents of Fine from the middle
    const [pitch, fine] = screen.getAllByTestId('mod-bar').map(({ style }) => [style.left, style.width]);
    expect(pitch).toEqual(['75%', '25%']);
    expect(fine).toEqual(['50%', '25%']);
  });

  it.each([
    [300, true],
    [620, false],
  ])('in a strip of %s px has Oct, Semi and Fine compact, without carets: %s', (width, compact) => {
    const restore = withElementSize(width, 26);
    try {
      setup();
      const field = screen.getByRole('slider', { name: 'Semi' });
      expect(field.parentElement?.classList.contains('compact')).toBe(compact);
      expect(field.querySelectorAll('.anticon')).toHaveLength(compact ? 0 : 2);
    } finally {
      restore();
    }
  });

  it('shows Unison under the wave with the arrows of Oct, 2 voices by default, dragged by whole voices from 1 to 8', () => {
    const { model } = setup();
    const unison = screen.getByRole('slider', { name: 'Unison' });
    expect(unison.getAttribute('aria-valuetext')).toBe('2');
    expect(unison.querySelectorAll('[role="img"]')).toHaveLength(2);
    drag(unison, [100, 0]);
    expect(model.$osc.value.unison).toBe(6);
    drag(unison, [0, -30]);
    expect(model.$osc.value.unison).toBe(7);
    expect(unison.getAttribute('aria-valuetext')).toBe('7');
    drag(unison, [500, 0]);
    expect(model.$osc.value.unison).toBe(8);
    drag(unison, [0, 500]);
    expect(model.$osc.value.unison).toBe(1);
  });

  it.each([
    [300, true],
    [620, false],
  ])('in a strip of %s px has the values under the wave compact: %s', (width, compact) => {
    const restore = withElementSize(width, 27);
    try {
      setup();
      const strip = screen.getByRole('slider', { name: 'Unison' }).parentElement;
      expect(strip?.classList.contains('compact')).toBe(compact);
    } finally {
      restore();
    }
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

  it('shows the frame of the Wave from 1 under the wave, of the frames played', () => {
    const { actions } = setup();
    const frames = [
      [0, 1, 0, -1],
      [1, 0, -1, 0],
      [0, -1, 0, 1],
    ];
    expect(screen.getByText('1/1')).toBeDefined();
    act(() => actions.setWaveTable(frames));
    act(() => actions.setPosition(2));
    expect(screen.getByText('3/3')).toBeDefined();
    act(() => actions.setPosition(1.37));
    expect(screen.getByText('2.4/3')).toBeDefined();
    // a table with a morph mark plays its 256 frames: its frame 2 at 128
    act(() => actions.setWaveTable(frames, true));
    act(() => actions.setPosition(128));
    expect(screen.getByText('129/256')).toBeDefined();
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
