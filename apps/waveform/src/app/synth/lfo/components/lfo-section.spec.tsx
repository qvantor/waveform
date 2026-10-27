import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Handle, HandleProps } from '@waveform/ui-kit';
import { withElementSize } from '@waveform/ui-kit/test-utils';
import {
  createEnvelopes,
  createLfos,
  createModulation,
  createSynthCore,
} from '../../../../test-utils/models';
import { EnvelopesContext } from '../../common/modules/envelopes';
import { LfoContext } from '../../common/modules/lfos';
import { ModulationContext } from '../../common/modules/modulation';
import { SynthCoreContext } from '../../common/modules/synth-core';
import { shapeOptionOf } from '../lfo-shapes';
import { LfoSection } from './lfo-section';

// the knobs are inspected by their props
jest.mock('@waveform/ui-kit', () => ({
  ...jest.requireActual('@waveform/ui-kit'),
  Handle: jest.fn(() => null),
}));

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and the
// document listeners of the drag
const pointer = (type: string, target: EventTarget, [clientX, clientY]: [number, number]) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

// drags a tab onto the element at the end (jsdom has no layout: elementFromPoint gives it)
const dragTab = (name: string, onto: Element | null) => {
  Object.assign(document, { elementFromPoint: () => onto });
  pointer('pointerdown', screen.getByRole('tab', { name }), [0, 0]);
  pointer('pointermove', document, [50, 50]);
  pointer('pointerup', document, [50, 50]);
  Reflect.deleteProperty(document, 'elementFromPoint');
};

const setup = () => {
  const synthCore = createSynthCore();
  const envelopes = createEnvelopes();
  const lfos = createLfos(synthCore);
  const modulation = createModulation();
  render(
    <SynthCoreContext.Provider value={synthCore}>
      <EnvelopesContext.Provider value={envelopes}>
        <LfoContext.Provider value={lfos}>
          <ModulationContext.Provider value={modulation}>
            <LfoSection />
            <div data-mod-target='osc1.wave' data-testid='wave' />
            <div data-mod-target='filter.gain' data-testid='gain' />
            <div data-mod-target='lfo2.rate' data-testid='rate' />
          </ModulationContext.Provider>
        </LfoContext.Provider>
      </EnvelopesContext.Provider>
    </SynthCoreContext.Provider>
  );
  const knob = (label: string) =>
    (Handle as jest.Mock).mock.calls
      .map(([props]) => props as HandleProps)
      .filter((props) => props.label === label)
      .at(-1) as HandleProps;
  return { envelopes, lfos, modulation, knob };
};

describe('LfoSection', () => {
  let restoreSize: () => void;
  beforeEach(() => (restoreSize = withElementSize(300, 60)));
  afterEach(() => {
    restoreSize();
    (Handle as jest.Mock).mockClear();
  });

  it('has the tabs LFO 1–4 in its header, LFO 1 shown', () => {
    setup();
    const tabs = within(screen.getByRole('tablist', { name: 'LFOs' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['LFO 1', 'LFO 2', 'LFO 3', 'LFO 4']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('lfo-chart')).toBeInTheDocument();
  });

  it('a tab shows its LFO and selects it: the knobs show its routes', () => {
    const { envelopes, lfos, knob } = setup();
    act(() => lfos[1].setLfoValue('lfo3', 'delay', 0.25));
    fireEvent.click(screen.getByRole('tab', { name: 'LFO 3' }));
    expect(lfos[0].$selected.value).toBe('lfo3');
    expect(envelopes[0].$selected.value).toBe('lfo3');
    expect(knob('Delay')).toMatchObject({ value: 0.25, modTarget: 'lfo3.delay' });
  });

  it('turns Rate by the frequency, right faster, and shows its period', () => {
    const { lfos, knob } = setup();
    expect(knob('Rate')).toMatchObject({ value: 2, min: 1 / 32, max: 100, mode: 'log' });
    expect(knob('Rate').formatValue?.(2)).toBe('500ms');
    act(() => knob('Rate').onChange?.(4));
    expect(lfos[0].$lfos.value.lfo1.rate).toBe(0.25);
    // within 10 ms..32 s
    act(() => knob('Rate').onChange?.(1000));
    expect(lfos[0].$lfos.value.lfo1.rate).toBe(0.01);
  });

  it('times by their travel, Phase in degrees around the cycle', () => {
    const { knob } = setup();
    expect(knob('Delay')).toMatchObject({ min: 0, max: 32, mode: 'pow' });
    expect(knob('Delay').wrap).toBeUndefined();
    expect(knob('Smooth')).toMatchObject({ min: 0, max: 0.5, mode: 'pow' });
    expect(knob('Phase')).toMatchObject({ min: 0, max: 1, wrap: true });
    expect(knob('Phase').formatValue?.(0.25)).toBe('90°');
  });

  it('chooses the shape and the mode', () => {
    const { lfos } = setup();
    const [shape, mode] = screen.getAllByRole('combobox');
    fireEvent.change(shape, { target: { value: 'square' } });
    fireEvent.change(mode, { target: { value: 'free' } });
    expect(lfos[0].$lfos.value.lfo1).toMatchObject({ shape: 'square', mode: 'free' });
  });

  it('lists the shapes by category: one of Sidechain, Rhythm or Steps sets its points, a basic one drops them', () => {
    const { lfos } = setup();
    const [shape] = screen.getAllByRole('combobox');
    const groups = within(shape).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('label'))).toEqual([
      'Basic',
      'Sidechain',
      'Rhythm',
      'Steps',
    ]);
    fireEvent.change(shape, { target: { value: 'pump' } });
    expect(lfos[0].$lfos.value.lfo1.points).toBeDefined();
    expect(shapeOptionOf(lfos[0].$lfos.value.lfo1)).toBe('pump');
    expect(shape).toHaveValue('pump');
    fireEvent.change(shape, { target: { value: 'triangle' } });
    expect(lfos[0].$lfos.value.lfo1).toMatchObject({ shape: 'triangle' });
    expect(lfos[0].$lfos.value.lfo1).not.toHaveProperty('points');
  });

  it('shows points of its own that are none of the list as Custom, not chosen', () => {
    const { lfos } = setup();
    const [shape] = screen.getAllByRole('combobox');
    expect(within(shape).queryByRole('option', { name: 'Custom' })).toBeNull();
    act(() =>
      lfos[1].setPoints('lfo1', [
        [0, 0, 0],
        [0.3, 1, 2],
      ])
    );
    expect(shape).toHaveValue('custom');
    expect(within(shape).getByRole('option', { name: 'Custom' })).toBeDisabled();
  });

  it('a point of the chart dragged makes the shape points of its own: Custom', () => {
    const { lfos } = setup();
    pointer('pointerdown', screen.getByRole('button', { name: 'Point 2' }), [75, 26]);
    pointer('pointermove', document, [75, 13]);
    pointer('pointerup', document, [75, 13]);
    expect(lfos[0].$lfos.value.lfo1.points?.[1]).toEqual([0.25, 0.75, 1.7]);
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('custom');
  });

  it('the dot of a tab has the number of the routes of its LFO', () => {
    const { modulation } = setup();
    const count = (tab: string) => within(screen.getByRole('tab', { name: tab })).getByTestId('route-count');
    expect(count('LFO 2')).toBeEmptyDOMElement();
    act(() => {
      modulation[1].addRoute('lfo2', 'osc1.wave');
      modulation[1].addRoute('lfo2', 'filter.cutoff');
    });
    expect(count('LFO 2')).toHaveTextContent('2');
    expect(count('LFO 1')).toBeEmptyDOMElement();
    act(() => modulation[1].removeRoute('lfo2', 'osc1.wave'));
    expect(count('LFO 2')).toHaveTextContent('1');
  });

  it('its knobs take the envelopes', () => {
    const { modulation, knob } = setup();
    act(() => modulation[1].addRoute('env2', 'lfo1.rate'));
    expect(knob('Rate').modulations).toEqual([expect.objectContaining({ id: 'env2', amount: 0.5 })]);
  });

  it('a tab dragged onto a knob assigns its LFO: bipolar on one centered on 0, none on a knob of an LFO', () => {
    const { modulation } = setup();
    dragTab('LFO 2', screen.getByTestId('wave'));
    dragTab('LFO 2', screen.getByTestId('gain'));
    dragTab('LFO 2', screen.getByTestId('rate'));
    expect(modulation[0].$routes.value).toEqual([
      { source: 'lfo2', target: 'osc1.wave', amount: 0.5 },
      { source: 'lfo2', target: 'filter.gain', amount: 0.5, bipolar: true },
    ]);
  });
});
