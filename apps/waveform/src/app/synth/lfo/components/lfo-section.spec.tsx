import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Handle, HandleProps } from '@waveform/ui-kit';
import { switchKeyTip as tip, withElementSize } from '@waveform/ui-kit/test-utils';
import { divisionIndex, TEMPO_DIVISIONS, TIME_DIVISIONS } from '@waveform/preset-schema';
import {
  createEnvelopes,
  createLfos,
  createModulation,
  createSynthCore,
  createTransport,
} from '../../../../test-utils/models';
import { EnvelopesContext } from '../../common/modules/envelopes';
import { LfoContext } from '../../common/modules/lfos';
import { ModulationContext } from '../../common/modules/modulation';
import { SynthCoreContext } from '../../common/modules/synth-core';
import { TransportContext } from '../../common/modules/transport';
import { LFO_STATE_INTERVAL } from '../../common/lfo/lfo-curve';
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
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  });
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
  const transport = createTransport(synthCore);
  const lfos = createLfos(synthCore, transport);
  const modulation = createModulation();
  render(
    <SynthCoreContext.Provider value={synthCore}>
      <TransportContext.Provider value={transport}>
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
      </TransportContext.Provider>
    </SynthCoreContext.Provider>
  );
  const knob = (label: string) =>
    (Handle as jest.Mock).mock.calls
      .map(([props]) => props as HandleProps)
      .filter((props) => props.label === label)
      .at(-1) as HandleProps;
  return { envelopes, lfos, modulation, transport, knob };
};

describe('LfoSection', () => {
  let restoreSize: () => void;
  beforeEach(() => (restoreSize = withElementSize(300, 60)));
  afterEach(() => {
    jest.useRealTimers();
    restoreSize();
    // (the tempo of the transport is kept by the browser)
    localStorage.clear();
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

  it('its knobs have the defaults of an LFO for their menus: Rate by the frequency of its period', () => {
    const { lfos, knob } = setup();
    expect(knob('Rate').defaultValue).toBe(2);
    act(() => knob('Rate').onChange?.(knob('Rate').defaultValue as number));
    expect(lfos[0].$lfos.value.lfo1.rate).toBe(0.5);
    expect(['Delay', 'Rise', 'Smooth', 'Phase'].map((label) => knob(label).defaultValue)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(knob('Delay').onClearModulations).toEqual(expect.any(Function));
  });

  it('times by their travel, Phase in degrees around the cycle', () => {
    const { knob } = setup();
    expect(knob('Delay')).toMatchObject({ min: 0, max: 32, mode: 'pow' });
    expect(knob('Delay').wrap).toBeUndefined();
    expect(knob('Smooth')).toMatchObject({ min: 0, max: 0.5, mode: 'pow' });
    expect(knob('Phase')).toMatchObject({ min: 0, max: 1, wrap: true });
    expect(knob('Phase').formatValue?.(0.25)).toBe('90°');
  });

  it('switches BPM, HOST only in Free, TRIP and DOT only in BPM', () => {
    const { lfos } = setup();
    const key = (name: string) => screen.getByRole('button', { name });
    expect(key('Tempo sync')).toHaveAttribute('aria-pressed', 'false');
    // Retrig: HOST changes nothing, it shows it is on, dimmed
    expect(key('Anchor to the beats')).toHaveAttribute('aria-pressed', 'true');
    expect(key('Anchor to the beats')).toBeDisabled();
    expect(key('Triplets')).toBeDisabled();
    expect(key('Dotted')).toBeDisabled();
    act(() => lfos[1].setMode('lfo1', 'free'));
    expect(key('Anchor to the beats')).toBeEnabled();
    fireEvent.click(key('Tempo sync'));
    fireEvent.click(key('Anchor to the beats'));
    fireEvent.click(key('Triplets'));
    fireEvent.click(key('Dotted'));
    expect(lfos[0].$lfos.value.lfo1).toMatchObject({ bpm: true, host: false, trip: true, dot: true });
    expect(key('Triplets')).toHaveAttribute('aria-pressed', 'true');
  });

  it('has the keys of the tempo on one plate: the anchor, the triplets and the dotted ones as icons', () => {
    setup();
    const keys = within(screen.getByRole('group', { name: 'Tempo' })).getAllByRole('button');
    expect(keys.map((key) => key.getAttribute('aria-label'))).toEqual([
      'Tempo sync',
      'Anchor to the beats',
      'Triplets',
      'Dotted',
    ]);
    expect(keys.map((key) => key.textContent)).toEqual(['BPM', '', '', '']);
    expect(keys.slice(1).every((key) => key.querySelector('svg'))).toBe(true);
  });

  it('hovered, a key tells what it does, a dimmed one why', () => {
    jest.useFakeTimers();
    const { lfos } = setup();
    expect(tip('Anchor to the beats')).toBe(
      'Anchor to the beatsKeeps the cycle on the beats of the tempoOnly in Free mode'
    );
    expect(tip('Triplets')).toBe('TripletsRate in triplets: ⅔ as longTurn on BPM to use it');
    act(() => lfos[1].setBpm('lfo1', true));
    expect(tip('Dotted')).toBe('DottedRate in dotted notes: 1.5× as long');
  });

  it('in BPM steps Rate through its divisions, right faster, Delay and Rise from Off', () => {
    const { lfos, knob } = setup();
    act(() => lfos[1].setBpm('lfo1', true));
    const rate = knob('Rate');
    expect(rate.value).toBe(divisionIndex('1/4'));
    expect(rate.formatValue?.(rate.value as number)).toBe('1/4');
    expect(rate.step?.map((division) => TEMPO_DIVISIONS[division].id)).toEqual([
      '32 bar',
      '16 bar',
      '8 bar',
      '4 bar',
      '2 bar',
      '1 bar',
      '1/2',
      '1/4',
      '1/8',
      '1/16',
      '1/32',
      '1/64',
      '1/128',
    ]);
    expect(rate).toMatchObject({ precision: 1, defaultValue: divisionIndex('1/4'), modTarget: 'lfo1.rate' });
    act(() => rate.onChange?.(divisionIndex('1/16')));
    expect(lfos[0].$lfos.value.lfo1.div).toBe(divisionIndex('1/16'));
    // with TRIP the triplets between them (1/256 and 1/256T are shorter than 10 ms at 120)
    act(() => lfos[1].setTrip('lfo1', true));
    expect(knob('Rate').step).toHaveLength(26);
    expect(
      knob('Rate')
        .step?.slice(15, 18)
        .map((division) => TEMPO_DIVISIONS[division].id)
    ).toEqual(['1/4T', '1/8', '1/8T']);
    expect(knob('Delay')).toMatchObject({ value: 0, defaultValue: 0, step: TIME_DIVISIONS });
    expect(knob('Delay').formatValue?.(0)).toBe('Off');
    act(() => knob('Rise').onChange?.(divisionIndex('2 bar')));
    expect(lfos[0].$lfos.value.lfo1.riseDiv).toBe(divisionIndex('2 bar'));
    // Smooth and Phase stay
    expect(knob('Smooth').step).toBeUndefined();
  });

  it('in BPM steps Rate through the divisions of 10 ms at least at the tempo, shows the one it plays', async () => {
    const { lfos, transport, knob } = setup();
    act(() => lfos[1].setBpm('lfo1', true));
    act(() => transport[1].setBpm(60));
    act(() => knob('Rate').onChange?.(divisionIndex('1/256')));
    expect(knob('Rate')).toMatchObject({ value: divisionIndex('1/256') });
    expect(knob('Rate').step?.at(-1)).toBe(divisionIndex('1/256'));
    // 1/256 at 120: 7.8 ms, it plays 1/128; the preset keeps 1/256 (a second tempo within LFO_STATE_INTERVAL
    // after it)
    await act(async () => {
      transport[1].setBpm(120);
      await new Promise((resolve) => setTimeout(resolve, LFO_STATE_INTERVAL * 1000 + 5));
    });
    expect(knob('Rate')).toMatchObject({ value: divisionIndex('1/128') });
    expect(knob('Rate').step?.at(-1)).toBe(divisionIndex('1/128'));
    expect(knob('Rate').formatValue?.(knob('Rate').value as number)).toBe('1/128');
    expect(lfos[0].$lfos.value.lfo1.div).toBe(divisionIndex('1/256'));
  });

  it('in BPM puts the routes of Rate, Delay and Rise on their steps in the units of HZ', () => {
    const { lfos, knob } = setup();
    expect(knob('Rate').modTravel).toBeUndefined();
    act(() => lfos[1].setBpm('lfo1', true));
    // the tempo of a synth without a transport: 120
    const rate = knob('Rate');
    const steps = rate.step ?? [];
    const share = (id: string) => steps.indexOf(divisionIndex(id)) / (steps.length - 1);
    const travel = rate.modTravel?.travel ?? (() => NaN);
    const position = rate.modTravel?.position ?? NaN;
    expect(travel(position)).toBeCloseTo(share('1/4'), 12);
    // an octave of 1/32..100 Hz: the next step
    expect(travel(position + 1 / Math.log2(3200))).toBeCloseTo(share('1/8'), 12);
    // Rise from Off: +25% of the travel of 32 s, 125 ms, a 16th
    const rise = knob('Rise').modTravel;
    expect(rise?.position).toBe(0);
    expect(rise?.travel(0.25)).toBeCloseTo(
      TIME_DIVISIONS.indexOf(divisionIndex('1/16')) / (TIME_DIVISIONS.length - 1),
      12
    );
    // in HZ none
    act(() => lfos[1].setBpm('lfo1', false));
    expect(knob('Rate').modTravel).toBeUndefined();
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
