import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AdsrEnvelope, formatTime } from '@waveform/ui-kit';
import { EnvelopesProvider, ModulationProvider, useEnvelopes, useModulation } from '../../common/modules';
import { EnvelopesModule } from '../../common/modules/envelopes';
import { ModulationModule } from '../../common/modules/modulation';
import { EnvelopeSection } from './envelope-section';

jest.mock('@waveform/ui-kit', () => ({
  ...jest.requireActual('@waveform/ui-kit'),
  AdsrEnvelope: jest.fn(() => null),
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
        <div data-mod-target='osc1.wave' data-testid='knob' />
      </ModulationProvider>
    </EnvelopesProvider>
  );
  if (!envelopes || !modulation) throw new Error('the models are not initialized');
  // the props of the chart and the knobs in the last render
  const props = () =>
    (AdsrEnvelope as jest.Mock).mock.lastCall?.[0] as React.ComponentProps<typeof AdsrEnvelope>;
  return { envelopes, modulation, props };
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

describe('EnvelopeSection', () => {
  afterEach(() => (AdsrEnvelope as jest.Mock).mockClear());

  it('has the tabs ENV 1 | ENV 2 | ENV 3 in its header, ENV 1 selected', () => {
    setup();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['ENV 1', 'ENV 2', 'ENV 3']);
    expect(screen.getByRole('tab', { name: 'ENV 1' })).toHaveAttribute('aria-selected', 'true');
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

  it('a tab dragged onto a knob assigns its envelope to it at +50%, once', () => {
    const { modulation } = setup();
    const [{ $routes }, { setAmount }] = modulation;
    dragTab('ENV 2', screen.getByTestId('knob'));
    expect($routes.value).toEqual([{ source: 'env2', target: 'osc1.wave', amount: 0.5 }]);
    setAmount('env2', 'osc1.wave', 0.2);
    dragTab('ENV 2', screen.getByTestId('knob'));
    dragTab('ENV 3', document.body);
    expect($routes.value).toEqual([{ source: 'env2', target: 'osc1.wave', amount: 0.2 }]);
    // the drag didn't select it
    expect(screen.getByRole('tab', { name: 'ENV 1' }).getAttribute('aria-selected')).toBe('true');
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
