import React from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Cascader } from 'antd';
import { CascadeOption, CascadeSelect, skipSingleFolders } from './cascade-select';

// the real cascader, its props are inspected; its popup is tested by antd
jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  const { createElement } = jest.requireActual('react');
  return { ...actual, Cascader: jest.fn((props: object) => createElement(actual.Cascader, props)) };
});

interface CascaderProps {
  options: CascadeOption[];
  value: (string | number)[];
  onChange: (value: (string | number)[]) => void;
}

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
  const cascader = () => (Cascader as unknown as jest.Mock).mock.lastCall?.[0] as CascaderProps;
  return { setValue, user, cascader };
};

const next = () => screen.getByRole('button', { name: 'Next' });
const previous = () => screen.getByRole('button', { name: 'Previous' });

describe('CascadeSelect', () => {
  afterEach(() => (Cascader as unknown as jest.Mock).mockClear());

  it('shows its children', () => {
    setup(['A', 'A/1.wav']);
    expect(screen.getByText('Current')).toBeDefined();
  });

  // the arrows go through the files across folders and wrap around
  it.each([
    { from: ['A', 'A/2.wav'], button: previous, to: ['A', 'A/1.wav'], name: 'previous: the file before' },
    { from: ['A', 'A/2.wav'], button: next, to: ['B', 'B/1.wav'], name: 'next: into the next folder' },
    {
      from: ['B', 'B/1.wav'],
      button: previous,
      to: ['A', 'A/2.wav'],
      name: 'previous: into the folder before',
    },
    {
      from: ['B', 'B/2.wav'],
      button: next,
      to: ['A', 'A/1.wav'],
      name: 'next from the last file: the first',
    },
    {
      from: ['A', 'A/1.wav'],
      button: previous,
      to: ['B', 'B/2.wav'],
      name: 'previous from the first: the last',
    },
    {
      from: ['C', 'C/1.wav'],
      button: next,
      to: ['A', 'A/1.wav'],
      name: 'next from an unknown value: the first',
    },
    {
      from: ['C', 'C/1.wav'],
      button: previous,
      to: ['B', 'B/2.wav'],
      name: 'previous from an unknown: the last',
    },
  ])('$name', async ({ from, button, to }) => {
    const { user, setValue } = setup(from);
    await user.click(button());
    expect(setValue).toHaveBeenCalledWith(to);
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

  describe('a single folder', () => {
    const pack: CascadeOption[] = [{ value: 'Pack', label: 'Pack', children: options }];

    it('is not a column: the cascader starts inside it', () => {
      const { cascader } = setup(['Pack', 'B', 'B/1.wav'], pack);
      expect(cascader().options).toBe(options);
      expect(cascader().value).toEqual(['B', 'B/1.wav']);
    });

    it('is put back into a path chosen in the cascader', () => {
      const { cascader, setValue } = setup(['Pack', 'B', 'B/1.wav'], pack);
      cascader().onChange(['A', 'A/2.wav']);
      expect(setValue).toHaveBeenCalledWith(['Pack', 'A', 'A/2.wav']);
    });

    it('stays in the paths of the arrows', async () => {
      const { user, setValue } = setup(['Pack', 'A', 'A/2.wav'], pack);
      await user.click(next());
      expect(setValue).toHaveBeenCalledWith(['Pack', 'B', 'B/1.wav']);
    });

    it('previous from the first file: the last', async () => {
      const { user, setValue } = setup(['Pack', 'A', 'A/1.wav'], pack);
      await user.click(previous());
      expect(setValue).toHaveBeenCalledWith(['Pack', 'B', 'B/2.wav']);
    });

    it('next from the last file: the first', async () => {
      const { user, setValue } = setup(['Pack', 'B', 'B/2.wav'], pack);
      await user.click(next());
      expect(setValue).toHaveBeenCalledWith(['Pack', 'A', 'A/1.wav']);
    });

    // e.g. from a preset: the cascader shows it as chosen, the arrows go to its neighbours
    it('a value without it is shown and stepped from', async () => {
      const { user, setValue, cascader } = setup(['A', 'A/2.wav'], pack);
      expect(cascader().value).toEqual(['A', 'A/2.wav']);
      await user.click(next());
      expect(setValue).toHaveBeenLastCalledWith(['Pack', 'B', 'B/1.wav']);
      await user.click(previous());
      expect(setValue).toHaveBeenLastCalledWith(['Pack', 'A', 'A/1.wav']);
    });

    it('a value outside it is passed as it is', () => {
      const { cascader } = setup(['Old', 'Old/1.wav'], pack);
      expect(cascader().value).toEqual(['Old', 'Old/1.wav']);
    });

    it('a cleared cascader keeps the value', () => {
      const { cascader, setValue } = setup(['Pack', 'B', 'B/1.wav'], pack);
      cascader().onChange(undefined as unknown as string[]);
      cascader().onChange([]);
      expect(setValue).not.toHaveBeenCalled();
    });

    it('several top folders are columns', () => {
      const { cascader } = setup(['A', 'A/1.wav']);
      expect(cascader().options).toBe(options);
      expect(cascader().value).toEqual(['A', 'A/1.wav']);
    });
  });
});

describe('skipSingleFolders', () => {
  it('skips nested single folders', () => {
    const nested = [
      { value: 'Pack', label: 'Pack', children: [{ value: 'Core', label: 'Core', children: options }] },
    ];
    expect(skipSingleFolders(nested)).toEqual({ prefix: ['Pack', 'Core'], options });
  });

  it('stops at a file', () => {
    const single = [{ value: 'Sine.wav', label: 'Sine' }];
    expect(skipSingleFolders([{ value: 'Pack', label: 'Pack', children: single }])).toEqual({
      prefix: ['Pack'],
      options: single,
    });
    expect(skipSingleFolders(single)).toEqual({ prefix: [], options: single });
  });

  it('returns an empty list for no data', () => {
    expect(skipSingleFolders([])).toEqual({ prefix: [], options: [] });
  });
});
