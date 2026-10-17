import React from 'react';
import { act, render } from '@testing-library/react';
import { Handle, HandleProps } from '@waveform/ui-kit';
import { createOscillator } from '../../../test-utils/models';
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

const setup = () => {
  const oscillator = createOscillator();
  const [model, actions] = oscillator;
  render(
    <Oscillator
      {...model}
      {...actions}
      useOscillator={(() => oscillator) as unknown as typeof useOscillator1}
    />
  );
  const knob = (label: string) =>
    (Handle as jest.Mock).mock.calls
      .map(([props]) => props as HandleProps)
      .filter((props) => props.label === label)
      .at(-1) as HandleProps;
  return { model, actions, knob };
};

describe('Oscillator', () => {
  afterEach(() => (Handle as jest.Mock).mockClear());

  it('has the knobs of the unison group in order: Unison, Detune, Phase, Phase rand', () => {
    setup();
    const labels = (Handle as jest.Mock).mock.calls.map(([props]) => (props as HandleProps).label);
    const group = labels.slice(labels.indexOf('Unison'), labels.indexOf('Unison') + 4);
    expect(group).toEqual(['Unison', 'Detune', 'Phase', 'Phase rand']);
    expect(useWavetables).toHaveBeenCalled();
  });

  it('turns Phase from 0 to 360 degrees, a share of the period', () => {
    const { knob, model } = setup();
    expect(knob('Phase')).toMatchObject({ min: 0, max: 1, value: 0, precision: 360 });
    expect(knob('Phase').formatValue?.(0.25)).toBe('90°');
    act(() => knob('Phase').onChange?.(0.5));
    expect(model.$osc.value.phase).toBe(0.5);
    expect(knob('Phase').value).toBe(0.5);
  });

  it('turns Phase rand from 0 to 100% of the period', () => {
    const { knob, model } = setup();
    expect(knob('Phase rand')).toMatchObject({ min: 0, max: 1, value: 1, precision: 100 });
    expect(knob('Phase rand').formatValue?.(0.5)).toBe('50%');
    act(() => knob('Phase rand').onChange?.(0));
    expect(model.$osc.value.phaseRand).toBe(0);
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
