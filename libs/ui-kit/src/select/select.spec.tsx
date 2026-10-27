import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Select } from './index';

const options = [
  { name: 'One', value: 'a' },
  { name: 'Two', value: 'b' },
  { name: 'Three', value: 'c' },
];

const renderSelect = (value = 'a') => {
  const onChange = jest.fn();
  render(<Select value={value} options={options} onChange={onChange} />);
  return { onChange, select: screen.getByRole('combobox') };
};

describe('Select', () => {
  it('passes the value of the chosen option', async () => {
    const { onChange, select } = renderSelect();
    await userEvent.setup().selectOptions(select, 'Two');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  // the arrows step on from the choice
  it('keeps the focus after a choice', () => {
    const { select } = renderSelect();
    select.focus();

    fireEvent.change(select, { target: { value: 'b' } });
    expect(document.activeElement).toBe(select);
  });

  it('has no arrows when told so', () => {
    render(<Select value='a' options={options} onChange={jest.fn()} arrows={false} />);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
  });

  it.each([
    ['Next', 'b', 'c'],
    ['Next', 'c', 'a'],
    ['Previous', 'b', 'a'],
    ['Previous', 'a', 'c'],
  ])('%s from %s goes to %s', async (button, value, next) => {
    const { onChange } = renderSelect(value);
    await userEvent.setup().click(screen.getByRole('button', { name: button }));
    expect(onChange).toHaveBeenCalledWith(next);
  });

  describe('groups', () => {
    const grouped = [
      { name: 'One', value: 'a', group: 'Odd' },
      { name: 'Three', value: 'c', group: 'Odd' },
      { name: 'Two', value: 'b', group: 'Even' },
      { name: 'Other', value: 'x', disabled: true },
    ];
    const renderGrouped = (value: string) => {
      const onChange = jest.fn();
      render(<Select value={value} options={grouped} onChange={onChange} />);
      return onChange;
    };

    it('lists the options of a group under its label, those of none apart', () => {
      renderGrouped('a');
      const names = (group: HTMLElement) =>
        within(group)
          .getAllByRole('option')
          .map(({ textContent }) => textContent);
      expect(screen.getAllByRole('group').map((group) => group.getAttribute('label'))).toEqual([
        'Odd',
        'Even',
      ]);
      expect(names(screen.getByRole('group', { name: 'Odd' }))).toEqual(['One', 'Three']);
      expect(names(screen.getByRole('group', { name: 'Even' }))).toEqual(['Two']);
      expect(screen.getByRole<HTMLOptionElement>('option', { name: 'Other' }).disabled).toBe(true);
    });

    it.each([
      ['Next', 'b', 'a'],
      ['Next', 'x', 'a'],
      ['Previous', 'a', 'b'],
      ['Previous', 'x', 'b'],
    ])('%s from %s steps over a disabled option to %s', async (button, value, next) => {
      const onChange = renderGrouped(value);
      await userEvent.setup().click(screen.getByRole('button', { name: button }));
      expect(onChange).toHaveBeenCalledWith(next);
    });
  });
});
