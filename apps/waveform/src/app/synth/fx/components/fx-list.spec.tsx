import React from 'react';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FX_TYPES } from '@waveform/preset-schema';
import { theme } from '@waveform/ui-kit';
import { renderWithFx } from '../../../../test-utils/fx-wrapper';
import { FX_REGISTRY } from '../effects';
import { FxList } from './fx-list';
import { FX_COLORS } from './fx-colors';

const setup = () => {
  const { fx } = renderWithFx(<FxList />);
  return { fx, user: userEvent.setup() };
};

// the sortable item is a button with the same name, the lamp is the one with aria-pressed
const getLamp = () =>
  screen
    .getAllByRole('button', { name: 'Delay' })
    .find((el) => el.hasAttribute('aria-pressed')) as HTMLElement;

describe('FxList', () => {
  it('a click anywhere on the row toggles the effect', async () => {
    const { fx, user } = setup();
    const lamp = getLamp();
    expect(fx[0].$effects.value.delay.added).toBe(false);

    await user.click(screen.getByText('Delay'));
    expect(fx[0].$effects.value.delay.added).toBe(true);
    expect(lamp).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByText('Delay'));
    expect(fx[0].$effects.value.delay.added).toBe(false);
  });

  it('a click on the lamp toggles the effect once', async () => {
    const { fx, user } = setup();
    const lamp = getLamp();

    await user.click(lamp);
    expect(fx[0].$effects.value.delay.added).toBe(true);

    await user.click(lamp);
    expect(fx[0].$effects.value.delay.added).toBe(false);
  });

  it('the lamp toggles the effect from the keyboard', async () => {
    const { fx, user } = setup();
    getLamp().focus();
    await user.keyboard('{Enter}');
    expect(fx[0].$effects.value.delay.added).toBe(true);
  });

  it('the row is highlighted while the effect is added', async () => {
    const { user } = setup();
    const row = screen.getByText('Delay').parentElement as HTMLElement;
    expect(row).not.toHaveClass('on');

    await user.click(row);
    expect(row).toHaveClass('on');

    await user.click(row);
    expect(row).not.toHaveClass('on');
  });

  it('lists delay and reverb in the chain order, each row toggles only its effect', async () => {
    const { fx, user } = setup();
    const delay = screen.getByText('Delay');
    const reverb = screen.getByText('Reverb');
    expect(delay.compareDocumentPosition(reverb)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await user.click(reverb);
    expect(fx[0].$effects.value.reverb.added).toBe(true);
    expect(fx[0].$effects.value.delay.added).toBe(false);
  });

  it('every effect has its icon and the big lamp', () => {
    setup();
    FX_TYPES.forEach((type) => {
      const row = screen.getByText(FX_REGISTRY[type].label).parentElement as HTMLElement;
      // the effect icon and the drag grip
      expect(row.querySelectorAll('svg')).toHaveLength(2);
      expect(row.querySelector('[aria-pressed]')).toHaveClass('m');
    });
  });

  it('every effect has its own color: reverb is green, delay stays blue', () => {
    expect(FX_COLORS.reverb).toBe(theme.colors.accent);
    expect(FX_COLORS.delay).toBe(theme.colors.secondAccent);
    expect(new Set(FX_TYPES.map((type) => FX_COLORS[type])).size).toBe(FX_TYPES.length);
  });

  it('the row border, the icon badge and the lamp get the effect color', async () => {
    const { user } = setup();
    for (const type of FX_TYPES) {
      const row = screen.getByText(FX_REGISTRY[type].label).parentElement as HTMLElement;
      // the border and the badge read it from the row
      expect(row.style.getPropertyValue('--fx-color')).toBe(FX_COLORS[type]);
      await user.click(row);
      expect(window.getComputedStyle(row.querySelector('[aria-pressed]') as HTMLElement).borderColor).toBe(
        FX_COLORS[type]
      );
    }
  });
});
