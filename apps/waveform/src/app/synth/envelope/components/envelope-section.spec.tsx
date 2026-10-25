import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AdsrEnvelope, formatTime, VelocityCurve, VelocityDot } from '@waveform/ui-kit';
import { MOD_SOURCES } from '@waveform/preset-schema';
import { EnvelopesProvider, ModulationProvider, useEnvelopes, useModulation } from '../../common/modules';
import { EnvelopesModule } from '../../common/modules/envelopes';
import { ModulationModule } from '../../common/modules/modulation';
import { SynthContext, SynthModule } from '../../common/modules/synth';
import type { FxNote } from '../../fx/effects/fx-modulation';
import { MOD_TARGETS } from '../../common/modulation/modulation-targets';
import { EnvelopeSection } from './envelope-section';
import { VelocitySection } from './velocity-section';
import { EnvelopeDot } from './envelope-dot';

jest.mock('@waveform/ui-kit', () => ({
  ...jest.requireActual('@waveform/ui-kit'),
  AdsrEnvelope: jest.fn(() => null),
  VelocityCurve: jest.fn(() => null),
  VelocityDot: jest.fn(() => null),
}));

const Capture = ({ onModel }: { onModel: (modules: [EnvelopesModule, ModulationModule]) => void }) => {
  onModel([useEnvelopes(), useModulation()]);
  return null;
};

const setup = () => {
  let envelopes: EnvelopesModule | undefined;
  let modulation: ModulationModule | undefined;
  render(
    <EnvelopesProvider initial={undefined}>
      <ModulationProvider initial={undefined}>
        <Capture onModel={(modules) => ([envelopes, modulation] = modules)} />
        <EnvelopeSection />
        <VelocitySection />
        <div data-mod-target='osc1.wave' data-testid='knob' />
      </ModulationProvider>
    </EnvelopesProvider>
  );
  if (!envelopes || !modulation) throw new Error('the models are not initialized');
  // the props of the chart and the knobs in the last render
  const props = () =>
    (AdsrEnvelope as jest.Mock).mock.lastCall?.[0] as React.ComponentProps<typeof AdsrEnvelope>;
  const velocityProps = () =>
    (VelocityCurve as jest.Mock).mock.lastCall?.[0] as React.ComponentProps<typeof VelocityCurve>;
  return { envelopes, modulation, props, velocityProps };
};

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

describe('EnvelopeSection and VelocitySection', () => {
  afterEach(() => {
    (AdsrEnvelope as jest.Mock).mockClear();
    (VelocityCurve as jest.Mock).mockClear();
    (VelocityDot as jest.Mock).mockClear();
  });

  it('has the tabs ENV 1 | ENV 2 | ENV 3 in its header, VELO has a section of its own, ENV 1 selected', () => {
    setup();
    const tabs = (name: string) =>
      within(screen.getByRole('tablist', { name }))
        .getAllByRole('tab')
        .map((tab) => tab.textContent);
    expect(tabs('Envelopes')).toEqual(['ENV 1', 'ENV 2', 'ENV 3']);
    expect(tabs('Velocity')).toEqual(['VELO']);
    expect(screen.getByRole('tab', { name: 'ENV 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'ENV 1' })).toHaveClass('selected');
    // the tab of its section, which always shows it
    expect(screen.getByRole('tab', { name: 'VELO' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'VELO' })).not.toHaveClass('selected');
  });

  it('a tab selects the envelope the knobs show and edit', () => {
    const { envelopes, props } = setup();
    const [{ $envelopes }] = envelopes;
    act(() => envelopes[1].setEnvelopeValue('env2', 'decay', 2.5));
    expect(props().decay).toBe(0);

    fireEvent.click(screen.getByRole('tab', { name: 'ENV 2' }));

    expect(screen.getByRole('tab', { name: 'ENV 2' })).toHaveAttribute('aria-selected', 'true');
    expect(props()).toMatchObject({ ...$envelopes.value.env2, decay: 2.5 });
    act(() => props().onChange('attack', 1.25));
    expect($envelopes.value.env2.attack).toBe(1.25);
    expect($envelopes.value.env1.attack).toBe(0.005);
  });

  it('the chart draws the curves of the selected tab, its points change them up to ±10, from the defaults', () => {
    const { envelopes, props } = setup();
    const [{ $envelopes }, { setEnvelopeCurve }] = envelopes;
    act(() => setEnvelopeCurve('env3', 'decay', -4));
    expect(props().curves).toEqual({ attack: 0, decay: 3.49, release: 3.49 });
    expect(props()).toMatchObject({ curveMax: 10, defaultCurves: { attack: 0, decay: 3.49, release: 3.49 } });

    fireEvent.click(screen.getByRole('tab', { name: 'ENV 3' }));
    expect(props().curves).toEqual({ attack: 0, decay: -4, release: 3.49 });
    act(() => props().onCurveChange?.('attack', 2.5));
    expect($envelopes.value.env3.curves).toEqual({ attack: 2.5, decay: -4, release: 3.49 });
    expect($envelopes.value.env1.curves.attack).toBe(0);
    // the dot of the note follows them
    expect((props().children as React.ReactElement).props.env).toBe($envelopes.value.env3);
  });

  it('the chart has the dot of the note on the envelope of the selected tab, one of its own per tab', () => {
    const { props } = setup();
    const dot = () => props().children as React.ReactElement;
    expect(dot()).toMatchObject({ type: EnvelopeDot, key: 'env1', props: { id: 'env1' } });
    fireEvent.click(screen.getByRole('tab', { name: 'ENV 3' }));
    expect(dot()).toMatchObject({ type: EnvelopeDot, key: 'env3', props: { id: 'env3' } });
  });

  it('only the selected tab has the grip of a drag', () => {
    setup();
    const grips = () =>
      screen.getAllByRole('tab').map((tab) => within(tab).queryByTestId('env-grip') !== null);
    expect(grips()).toEqual([true, false, false, false]);
    fireEvent.click(screen.getByRole('tab', { name: 'ENV 2' }));
    expect(grips()).toEqual([false, true, false, false]);
  });

  it('VELO selected, the ENV section shows the last envelope: its tab a translucent key, the grip on VELO', () => {
    const { envelopes, props } = setup();
    const tab = (name: string) => screen.getByRole('tab', { name });
    fireEvent.click(tab('ENV 2'));
    fireEvent.click(tab('VELO'));
    expect(envelopes[0].$selected.value).toBe('velo');
    expect(props()).toMatchObject(envelopes[0].$envelopes.value.env2);
    expect(tab('ENV 2')).toHaveAttribute('aria-selected', 'true');
    expect(tab('ENV 2')).toHaveClass('shown');
    expect(tab('ENV 2')).not.toHaveClass('selected');
    expect(tab('VELO')).toHaveClass('selected');
    expect(within(tab('VELO')).queryByTestId('env-grip')).not.toBeNull();
    expect(within(tab('ENV 2')).queryByTestId('env-grip')).toBeNull();

    fireEvent.click(tab('ENV 3'));
    expect(envelopes[0].$selected.value).toBe('env3');
    expect(tab('ENV 3')).toHaveClass('selected');
    expect(tab('ENV 3')).not.toHaveClass('shown');
    expect(tab('VELO')).not.toHaveClass('selected');
  });

  it('the VELO section shows the curve of the velocity and Amp, they edit its knobs, the dot of a note on it', () => {
    const { envelopes, velocityProps } = setup();
    expect(velocityProps()).toMatchObject({ k: 0, amp: 1, curveMax: 10 });
    // a child of the chart on its curve: a note renders it alone
    expect(velocityProps().children).toMatchObject({ props: { k: 0 } });
    act(() => velocityProps().onCurveChange(-2.5));
    act(() => velocityProps().onAmpChange(0.4));
    expect(envelopes[0].$velocity.value).toEqual({ amp: 0.4, k: -2.5 });
    expect(velocityProps()).toMatchObject({ k: -2.5, amp: 0.4 });
  });

  it('the dot of the last note on the curve: none before a note, then at its velocity on the curve of k', () => {
    const { velocityProps } = setup();
    const $fxNote = new BehaviorSubject<FxNote | null>(null);
    const synth = [{ $fxNote }, {}] as unknown as SynthModule;
    // the child of the chart alone: a note renders it, not the chart
    render(<SynthContext.Provider value={synth}>{velocityProps().children}</SynthContext.Provider>);
    expect(VelocityDot).not.toHaveBeenCalled();
    const renders = (VelocityCurve as jest.Mock).mock.calls.length;
    act(() => $fxNote.next({ envelopes: [], start: 1, release: null, velo: 0.6, velocity: 0.6 }));
    expect((VelocityDot as jest.Mock).mock.lastCall?.[0]).toEqual({ k: 0, velocity: 0.6 });
    expect((VelocityCurve as jest.Mock).mock.calls).toHaveLength(renders);
  });

  it('the VELO tab dragged onto a knob assigns the velocity to it', () => {
    const { modulation } = setup();
    dragTab('VELO', screen.getByTestId('knob'));
    expect(modulation[0].$routes.value).toEqual([{ source: 'velo', target: 'osc1.wave', amount: 0.5 }]);
    expect(screen.getByRole('tab', { name: 'VELO' })).toHaveClass('selected');
  });

  it('a tab dragged onto a knob assigns its envelope to it at +50%, once, and selects it', () => {
    const { modulation } = setup();
    const [{ $routes }, { setAmount }] = modulation;
    dragTab('ENV 2', screen.getByTestId('knob'));
    expect($routes.value).toEqual([{ source: 'env2', target: 'osc1.wave', amount: 0.5 }]);
    setAmount('env2', 'osc1.wave', 0.2);
    dragTab('ENV 2', screen.getByTestId('knob'));
    dragTab('ENV 3', document.body);
    expect($routes.value).toEqual([{ source: 'env2', target: 'osc1.wave', amount: 0.2 }]);
    // the drop selected it: the knobs show its routes
    expect(screen.getByRole('tab', { name: 'ENV 2' }).getAttribute('aria-selected')).toBe('true');
  });

  it('with 64 routes a dragged tab adds none', () => {
    const { modulation } = setup();
    const [{ $routes }, { addRoute }] = modulation;
    // every envelope on every knob but ENV 3 on Wave of OSC 1, up to 64
    act(() =>
      MOD_SOURCES.flatMap((source) => Object.keys(MOD_TARGETS).map((target) => [source, target] as const))
        .filter(([source, target]) => source !== 'env3' || target !== 'osc1.wave')
        .slice(0, 64)
        .forEach(([source, target]) => addRoute(source, target))
    );
    const routes = $routes.value;
    expect(routes).toHaveLength(64);
    dragTab('ENV 3', screen.getByTestId('knob'));
    expect($routes.value).toBe(routes);
  });

  it('has stages up to 32 s', () => {
    const { props } = setup();
    expect(props().maxTime).toBe(32);
    expect(formatTime(0.0005)).toBe('0.5ms');
    expect(formatTime(0.25)).toBe('250ms');
    expect(formatTime(1.234)).toBe('1.23s');
    expect(formatTime(12.34)).toBe('12.3s');
  });
});
