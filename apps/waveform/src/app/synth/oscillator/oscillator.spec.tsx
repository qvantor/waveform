import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Handle, HandleProps } from '@waveform/ui-kit';
import { createOscillator } from '../../../test-utils/models';
import { withElementSize } from '../../../test-utils/element-size';
import { useOscillator1 } from '../common/modules';
import { useWavetables } from './hooks/use-wavetables';
import { PHASE_FADE } from './components/wave/phase-overlay';
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
  return { model, actions, knob, drag };
};

describe('Oscillator', () => {
  afterEach(() => (Handle as jest.Mock).mockClear());

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
    const { model, drag } = setup();
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
    const { model, drag } = setup();
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

  it('shows the phase over the wave while Phase or Phase rand is held, fades it out once let go', () => {
    const restore = withElementSize(200, 100);
    jest.useFakeTimers();
    try {
      setup();
      const phase = screen.getByRole('slider', { name: 'Phase' });
      expect(screen.queryByTestId('phase-overlay')).toBeNull();
      pointer('pointerdown', phase, [100, 100]);
      expect(screen.getByTestId('phase-overlay').style.opacity).toBe('1');
      pointer('pointerup', document, [100, 100]);
      act(() => {
        jest.advanceTimersByTime(PHASE_FADE);
      });
      expect(screen.queryByTestId('phase-overlay')).toBeNull();
      pointer('pointerdown', screen.getByRole('slider', { name: 'Phase rand' }), [100, 100]);
      expect(screen.getByTestId('phase-overlay')).toBeDefined();
      pointer('pointerup', document, [100, 100]);
    } finally {
      jest.useRealTimers();
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
