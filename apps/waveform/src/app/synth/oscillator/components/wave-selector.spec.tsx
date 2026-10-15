import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { CascadeOption, CascadeSelect } from '@waveform/ui-kit';
import { createOscillator } from '../../../../test-utils/models';
import { OscillatorContext } from '../hooks';
import { useWavetables } from '../hooks/use-wavetables';
import { WaveSelector } from './wave-selector';

// the real cascade (its arrows are clicked), its props are inspected; the antd popup is tested by antd
jest.mock('@waveform/ui-kit', () => {
  const actual = jest.requireActual('@waveform/ui-kit');
  return { ...actual, CascadeSelect: jest.fn(actual.CascadeSelect) };
});

jest.mock('../hooks/use-wavetables', () => ({
  ...jest.requireActual('../hooks/use-wavetables'),
  useWavetables: jest.fn(),
}));

type CascadeProps = React.ComponentProps<typeof CascadeSelect>;

const files = [
  { value: 'ESW/Analog/Saw.wav', label: 'Saw' },
  { value: 'ESW/Analog/Square.wav', label: 'Square' },
];

const categories: CascadeOption[] = [
  { value: 'Analog', label: 'Analog', children: files },
  { value: 'Basics', label: 'Basics', children: [{ value: 'ESW/Basics/Sine.wav', label: 'Sine' }] },
];

const wavetables: CascadeOption[] = [{ value: 'ESW', label: 'ESW', children: categories }];

// the tables load at once: the first one before the render, the ones switched to inside the click
// (user-event has its own @testing-library/dom, without the act of @testing-library/react)
const setup = async (initialWavePath = ['ESW', 'Analog', 'ESW/Analog/Square.wav'], options = wavetables) => {
  (useWavetables as jest.Mock).mockReturnValue(options);
  const oscillator = createOscillator(undefined, 'osc1', { active: true, initialWavePath }, () =>
    Promise.resolve([[0, 1, 0, -1]])
  );
  const [model] = oscillator;
  await waitFor(() => expect(model.$waveTableLoading.value).toBe(false));
  const user = userEvent.setup();
  render(
    <OscillatorContext.Provider value={oscillator}>
      <WaveSelector />
    </OscillatorContext.Provider>
  );
  const props = () => (CascadeSelect as jest.Mock).mock.lastCall?.[0] as CascadeProps;
  const click = (element: Element) => act(() => user.click(element));
  const path = () => model.$waveTablePath.value;
  return { click, props, path, model };
};

const next = () => screen.getByRole('button', { name: 'Next' });
const previous = () => screen.getByRole('button', { name: 'Previous' });

describe('WaveSelector', () => {
  afterEach(() => (CascadeSelect as jest.Mock).mockClear());

  it('shows the name of the current wavetable', async () => {
    await setup();
    expect(screen.getByText('Square')).toBeInTheDocument();
  });

  it('the only pack is not a column: the cascade shows its folders and files', async () => {
    const { props } = await setup();
    expect(props().options).toBe(categories);
    expect(props().value).toEqual(['Analog', 'ESW/Analog/Square.wav']);
  });

  it('a file chosen in the cascade sets the whole path, the pack included', async () => {
    const { props, path } = await setup();
    await act(async () => props().setValue(['Basics', 'ESW/Basics/Sine.wav']));
    expect(path()).toEqual(['ESW', 'Basics', 'ESW/Basics/Sine.wav']);
    expect(props().value).toEqual(['Basics', 'ESW/Basics/Sine.wav']);
    expect(screen.getByText('Sine')).toBeInTheDocument();
  });

  it('next switches to the next wavetable, also in the next folder', async () => {
    const { click, path, model } = await setup(['ESW', 'Analog', 'ESW/Analog/Saw.wav']);
    await click(next());
    expect(path()).toEqual(['ESW', 'Analog', 'ESW/Analog/Square.wav']);
    expect(screen.getByText('Square')).toBeInTheDocument();
    await click(next());
    expect(path()).toEqual(['ESW', 'Basics', 'ESW/Basics/Sine.wav']);
    expect(screen.getByText('Sine')).toBeInTheDocument();
    expect(model.$waveTableLoading.value).toBe(false);
  });

  it('previous from the first wavetable goes to the last one', async () => {
    const { click, path } = await setup(['ESW', 'Analog', 'ESW/Analog/Saw.wav']);
    await click(previous());
    expect(path()).toEqual(['ESW', 'Basics', 'ESW/Basics/Sine.wav']);
  });

  it('with several packs the pack is a column', async () => {
    const options: CascadeOption[] = [
      ...wavetables,
      { value: 'Other', label: 'Other', children: [{ value: 'Other/Pulse.wav', label: 'Pulse' }] },
    ];
    const { click, props, path } = await setup(['ESW', 'Basics', 'ESW/Basics/Sine.wav'], options);
    expect(props().options).toBe(options);
    expect(props().value).toEqual(['ESW', 'Basics', 'ESW/Basics/Sine.wav']);
    await click(next());
    expect(path()).toEqual(['Other', 'Other/Pulse.wav']);
  });

  it('a path outside the pack is passed as it is', async () => {
    const { props } = await setup(['Old', 'Old/Saw.wav']);
    expect(props().value).toEqual(['Old', 'Old/Saw.wav']);
  });
});
