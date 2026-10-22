import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
});
