import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { DELAY_PRESETS } from '../effects/delay-presets';
import { PresetSelect } from './preset-select';

const [first, second] = DELAY_PRESETS;
const last = DELAY_PRESETS[DELAY_PRESETS.length - 1];

const setup = (preset: Pick<typeof first, 'mix' | 'params'> = first) => {
  const onSelect = jest.fn();
  const user = userEvent.setup();
  const result = render(<PresetSelect type='delay' {...preset} onSelect={onSelect} />);
  const select = () => screen.getByRole('combobox') as HTMLSelectElement;
  return { ...result, onSelect, user, select };
};

describe('PresetSelect', () => {
  it('shows the matching preset in a captioned group, without Custom', () => {
    const { select } = setup(second);
    expect(screen.getByRole('group', { name: 'Preset' })).toBeInTheDocument();
    expect(select().value).toBe(second.id);
    expect(select()).not.toHaveClass('custom');
    expect(screen.getByRole('option', { name: second.name })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Custom' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(DELAY_PRESETS.length);
  });

  it('shows Custom when the sound matches no preset', () => {
    const { select } = setup({ ...first, params: { ...first.params, time: 0.5 } });
    expect(select().value).toBe('');
    expect(select()).toHaveClass('custom');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Custom');
  });

  it('selects a preset from the list', async () => {
    const { user, select, onSelect } = setup();
    await user.selectOptions(select(), DELAY_PRESETS[4].name);
    expect(onSelect).toHaveBeenLastCalledWith(DELAY_PRESETS[4].id);
  });

  it('does not keep the focus after selecting a preset', async () => {
    const { user, select } = setup();
    await user.selectOptions(select(), DELAY_PRESETS[4].name);
    expect(select()).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it('is skipped by Tab and the arrows never take the focus', async () => {
    const { user } = setup();
    await user.tab();
    expect(document.body).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Next preset' }));
    expect(document.body).toHaveFocus();
  });

  it('steps through the presets and wraps around', async () => {
    const { user, onSelect, rerender } = setup();
    await user.click(screen.getByRole('button', { name: 'Next preset' }));
    expect(onSelect).toHaveBeenLastCalledWith(second.id);
    await user.click(screen.getByRole('button', { name: 'Previous preset' }));
    expect(onSelect).toHaveBeenLastCalledWith(last.id);

    rerender(<PresetSelect type='delay' {...last} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Next preset' }));
    expect(onSelect).toHaveBeenLastCalledWith(first.id);
  });

  it('steps from Custom to the first and the last preset, never selects Custom', async () => {
    const { user, onSelect, select } = setup({ ...first, mix: 0.9 });
    await user.click(screen.getByRole('button', { name: 'Next preset' }));
    expect(onSelect).toHaveBeenLastCalledWith(first.id);
    await user.click(screen.getByRole('button', { name: 'Previous preset' }));
    expect(onSelect).toHaveBeenLastCalledWith(last.id);
    await user.selectOptions(select(), 'Custom');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});
