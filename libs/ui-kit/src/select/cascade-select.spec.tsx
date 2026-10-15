import React from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { CascadeOption, CascadeSelect } from './cascade-select';

const options: CascadeOption[] = [
  {
    value: 'A',
    label: 'A',
    children: [
      { value: 'A/1.wav', label: '1' },
      { value: 'A/2.wav', label: '2' },
    ],
  },
  {
    value: 'B',
    label: 'B',
    children: [
      { value: 'B/1.wav', label: '1' },
      { value: 'B/2.wav', label: '2' },
    ],
  },
];

const setup = (value: string[], opts = options) => {
  const setValue = jest.fn();
  const user = userEvent.setup();
  render(
    <CascadeSelect options={opts} value={value} setValue={setValue} loading={false}>
      Current
    </CascadeSelect>
  );
  return { setValue, user };
};

const next = () => screen.getByRole('button', { name: 'Next' });
const previous = () => screen.getByRole('button', { name: 'Previous' });

describe('CascadeSelect', () => {
  it('shows its children', () => {
    setup(['A', 'A/1.wav']);
    expect(screen.getByText('Current')).toBeDefined();
  });

  it('steps to the neighbour files', async () => {
    const { user, setValue } = setup(['A', 'A/2.wav']);
    await user.click(previous());
    expect(setValue).toHaveBeenLastCalledWith(['A', 'A/1.wav']);
    await user.click(next());
    expect(setValue).toHaveBeenLastCalledWith(['B', 'B/1.wav']);
  });

  it('goes over to the next and the previous folder', async () => {
    const { user, setValue } = setup(['B', 'B/1.wav']);
    await user.click(previous());
    expect(setValue).toHaveBeenLastCalledWith(['A', 'A/2.wav']);
  });

  it('wraps around at the ends', async () => {
    const { user, setValue } = setup(['B', 'B/2.wav']);
    await user.click(next());
    expect(setValue).toHaveBeenLastCalledWith(['A', 'A/1.wav']);
  });

  it('wraps from the first file to the last', async () => {
    const { user, setValue } = setup(['A', 'A/1.wav']);
    await user.click(previous());
    expect(setValue).toHaveBeenLastCalledWith(['B', 'B/2.wav']);
  });

  it('from an unknown value goes to the first or the last file', async () => {
    const { user, setValue } = setup(['C', 'C/1.wav']);
    await user.click(next());
    expect(setValue).toHaveBeenLastCalledWith(['A', 'A/1.wav']);
    await user.click(previous());
    expect(setValue).toHaveBeenLastCalledWith(['B', 'B/2.wav']);
  });

  it('steps through files of the top level and of folders', async () => {
    const mixed: CascadeOption[] = [{ value: 'top.wav', label: 'top' }, ...options];
    const { user, setValue } = setup(['top.wav'], mixed);
    await user.click(next());
    expect(setValue).toHaveBeenLastCalledWith(['A', 'A/1.wav']);
    await user.click(previous());
    expect(setValue).toHaveBeenLastCalledWith(['B', 'B/2.wav']);
  });

  it('does nothing without options', async () => {
    const { user, setValue } = setup([], []);
    await user.click(next());
    await user.click(previous());
    expect(setValue).not.toHaveBeenCalled();
  });
});
