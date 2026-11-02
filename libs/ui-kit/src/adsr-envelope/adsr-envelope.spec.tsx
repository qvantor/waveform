import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { withElementSize } from '../common/test-utils/element-size';
import { Handle, HandleProps } from '../handle';
import { AdsrEnvelope, AdsrSteps } from './index';

// the knobs are inspected by their props
jest.mock('../handle', () => ({ ...jest.requireActual('../handle'), Handle: jest.fn(() => null) }));

const knob = (label: string) =>
  (Handle as jest.Mock).mock.calls
    .map(([props]) => props as HandleProps)
    .filter((props) => props.label === label)
    .at(-1) as HandleProps;

const stages = { attack: 0.5, hold: 0, decay: 1, sustain: 0.5, release: 2 };
const LABELS = ['1/16', '1/8', '1/4', '1/2', 'bar'];

describe('AdsrEnvelope', () => {
  let restoreSize: () => void;
  beforeEach(() => (restoreSize = withElementSize(300, 100)));
  afterEach(() => {
    restoreSize();
    (Handle as jest.Mock).mockClear();
  });

  it('turns the times by their travel in seconds', () => {
    const onChange = jest.fn();
    render(<AdsrEnvelope {...stages} maxTime={32} onChange={onChange} defaultValues={stages} />);
    expect(knob('Attack')).toMatchObject({ value: 0.5, min: 0, max: 32, mode: 'pow', defaultValue: 0.5 });
    expect(knob('Attack').step).toBeUndefined();
    expect(screen.getByText('500ms')).toBeTruthy();
    act(() => knob('Release').onChange?.(1.23456));
    expect(onChange).toHaveBeenLastCalledWith('release', 1.2346);
  });

  it('steps the times in steps of their own, the chart in seconds; a control right of Release', () => {
    const onChange = jest.fn();
    const timeSteps: AdsrSteps = {
      steps: [0, 1, 2, 3, 4],
      values: { attack: 2, hold: 0, decay: 3, release: 4 },
      format: (value) => LABELS[value],
      defaults: { attack: 1, hold: 0, decay: 1, release: 1 },
      onChange,
    };
    render(
      <AdsrEnvelope
        {...stages}
        maxTime={32}
        onChange={jest.fn()}
        timeSteps={timeSteps}
        aside={<button type='button'>BPM</button>}
      />
    );
    expect(knob('Attack')).toMatchObject({ value: 2, step: [0, 1, 2, 3, 4], precision: 1, defaultValue: 1 });
    expect(knob('Attack').formatValue?.(2)).toBe('1/4');
    expect(screen.getByText('1/4')).toBeTruthy();
    expect(screen.getByText('bar')).toBeTruthy();
    // the sustain is a level all the same
    expect(knob('Sustain').step).toBeUndefined();
    act(() => knob('Decay').onChange?.(1));
    expect(onChange).toHaveBeenLastCalledWith('decay', 1);
    // next to the knob of Release (its value: bar), out of the chart
    const bpm = screen.getByRole('button', { name: 'BPM' });
    expect(screen.getByText('bar').parentElement?.nextElementSibling?.contains(bpm)).toBe(true);
    expect(bpm.closest('svg')).toBeNull();
  });
});
