import React from 'react';
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FX_TYPES } from '@waveform/preset-schema';
import { renderWithFx } from '../../../../test-utils/fx-wrapper';
import { FxPanel } from './fx-panel';

const setup = () => {
  const { fx } = renderWithFx(<FxPanel type='delay' />);
  return { fx, user: userEvent.setup() };
};

describe('FxPanel', () => {
  it('shows the effect name first, then the presets, then the controls', () => {
    setup();
    const header = screen.getByRole('button', { name: 'Delay' });
    const preset = screen.getByRole('group', { name: 'Preset' });
    const mode = screen.getByRole('group', { name: 'Mode' });
    expect(header).toHaveTextContent('Delay');
    expect(header.compareDocumentPosition(preset)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(preset.compareDocumentPosition(mode)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect((within(preset).getByRole('combobox') as HTMLSelectElement).value).toBe('default');
  });

  it('the name toggles the effect on and off', async () => {
    const { fx, user } = setup();
    const header = screen.getByRole('button', { name: 'Delay' });
    expect(header).toHaveAttribute('aria-pressed', 'true');

    await user.click(header);
    expect(fx[0].$effects.value.delay.on).toBe(false);
    expect(header).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Out' })).toHaveClass('disabled');

    await user.click(header);
    expect(fx[0].$effects.value.delay.on).toBe(true);
  });

  it.each([
    ['distortion', ['drive', 'tone', 'level', 'mix']],
    ['delay', ['pan', 'time', 'fb', 'freq', 'q', 'mix']],
    ['reverb', ['lowcut', 'pre', 'size', 'decay', 'damp', 'bass', 'er', 'sep', 'depth', 'mix']],
  ] as const)('%s: every knob and fader takes the envelopes, the switches do not', (type, knobs) => {
    const { container } = renderWithFx(<FxPanel type={type} />);
    const targets = Array.from(container.querySelectorAll('[data-mod-target]')).map((element) =>
      element.getAttribute('data-mod-target')
    );
    expect(targets.sort()).toEqual(knobs.map((knob) => `${type}.${knob}`).sort());
  });

  it('a bypassed effect takes none', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Delay' }));
    expect(document.querySelector('[data-mod-target]')).toBeNull();
  });

  it('selecting a preset applies it to the model', async () => {
    const { fx, user } = setup();
    await user.selectOptions(screen.getByRole('combobox'), 'Dub');
    expect(fx[0].$effects.value.delay).toMatchObject({ mix: 0.35, params: { mode: 1, time: 0.5 } });
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('dub');
  });

  // every effect: a new one that doesn't put out after its last group loses its mix
  it.each(FX_TYPES)('%s: Out ends the flow of the groups, together with the last one', (type) => {
    renderWithFx(<FxPanel type={type} />);
    const out = screen.getByRole('group', { name: 'Out' });
    // they wrap to a new line together
    const pair = out.parentElement as HTMLElement;
    expect(pair.children).toHaveLength(2);
    expect(pair.firstElementChild).toHaveAttribute('role', 'group');
    expect(pair.lastElementChild).toBe(out);
    // one wrapping flow: the first group, ..., the pair
    const flow = pair.parentElement as HTMLElement;
    expect(flow.lastElementChild).toBe(pair);
    Array.from(flow.children)
      .slice(0, -1)
      .forEach((group) => expect(group).toHaveAttribute('role', 'group'));
  });

  it('shows the reverb with its controls and presets', async () => {
    const { fx } = renderWithFx(<FxPanel type='reverb' />);
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Reverb' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Decay' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox'), 'Large hall');
    expect(fx[0].$effects.value.reverb).toMatchObject({ mix: 0.3, params: { decay: 3.5, size: 0.8 } });
    expect(fx[0].$effects.value.delay.params['time']).toBe(0.2);
  });
});
