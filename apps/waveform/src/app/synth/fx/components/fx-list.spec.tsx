import React from 'react';
import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FX_TYPES } from '@waveform/preset-schema';
import { theme } from '@waveform/ui-kit';
import { renderWithFx } from '../../../../test-utils/fx-wrapper';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { applySnapshot } from '../../../app';
import { FX_REGISTRY } from '../effects';
import { FxList } from './fx-list';
import { FX_COLORS } from './fx-colors';
import { FxScreen } from './fx-screen';

const setup = (ui = <FxList />) => {
  const { fx } = renderWithFx(ui);
  return { fx, user: userEvent.setup() };
};

// the reverb module loads asynchronously
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve)));

// the first worklet module load fails (404, offline), the next ones succeed; test-setup restores the mock
const failFirstWorkletLoad = () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const addModule = jest.fn().mockRejectedValueOnce(new Error('404')).mockResolvedValue(undefined);
  Object.defineProperty(AudioContext.prototype, 'audioWorklet', {
    configurable: true,
    get: () => ({ addModule }),
  });
  return addModule;
};

// the sortable item is a button with the same name, the lamp is the one with aria-pressed
const getLampOf = (name: string) =>
  screen.getAllByRole('button', { name }).find((el) => el.hasAttribute('aria-pressed')) as HTMLElement;
const getLamp = () => getLampOf('Delay');
// the lamp sits right in the row
const getRowOf = (name: string) => getLampOf(name).parentElement as HTMLElement;

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

  describe('unavailable effects', () => {
    afterEach(() => jest.restoreAllMocks());

    it('without AudioWorklet the reverb says why and can not be turned on, the delay works', async () => {
      withoutAudioWorklet();
      const { fx, user } = setup();
      const row = getRowOf('Reverb');
      expect(row).toHaveTextContent('Not supported by this browser');
      expect(row).toHaveClass('unavailable', 'unsupported');
      expect(getLampOf('Reverb')).toHaveAccessibleDescription('Not supported by this browser');

      await user.click(row);
      await user.click(getLampOf('Reverb'));
      expect(fx[0].$effects.value.reverb.added).toBe(false);
      expect(getLampOf('Reverb')).toHaveAttribute('aria-pressed', 'false');

      await user.click(getRowOf('Delay'));
      expect(fx[0].$effects.value.delay.added).toBe(true);
      expect(getRowOf('Delay')).not.toHaveClass('unavailable');
      expect(getLampOf('Delay')).not.toHaveAttribute('aria-describedby');
    });

    it('on a page that is not a secure context the warning asks for https', () => {
      withoutAudioWorklet({ secureContext: false });
      setup();
      expect(getRowOf('Reverb')).toHaveTextContent('Needs HTTPS or localhost');
    });

    it('a reverb added by a preset shows as added but unavailable, a click removes it for good', async () => {
      withoutAudioWorklet();
      const { fx, user } = setup();
      act(() => applySnapshot({ fx: { reverb: { a: true } } }));
      expect(fx[0].$effects.value.reverb.added).toBe(true);
      expect(getLampOf('Reverb')).toHaveAttribute('aria-pressed', 'true');
      expect(getRowOf('Reverb')).toHaveClass('on', 'unavailable');
      // it can be clicked: no not-allowed cursor
      expect(getRowOf('Reverb')).not.toHaveClass('unsupported');

      await user.click(getRowOf('Reverb'));
      expect(fx[0].$effects.value.reverb.added).toBe(false);
      expect(getLampOf('Reverb')).toHaveAttribute('aria-pressed', 'false');
      expect(getRowOf('Reverb')).toHaveClass('unsupported');

      await user.click(getRowOf('Reverb'));
      expect(fx[0].$effects.value.reverb.added).toBe(false);
    });

    it('the fx screen works without AudioWorklet, the rack shows only the usable effects', () => {
      withoutAudioWorklet();
      setup(<FxScreen />);
      act(() => applySnapshot({ fx: { reverb: { a: true }, delay: { a: true } } }));
      // the delay is in the list and in the rack, the reverb only in the list
      expect(screen.getAllByText('Delay')).toHaveLength(2);
      expect(screen.getAllByText('Reverb')).toHaveLength(1);
    });

    it('a failed load says so, a click on the row loads it again and turns it on', async () => {
      const addModule = failFirstWorkletLoad();
      const { fx, user } = setup();
      await flush();
      const row = getRowOf('Reverb');
      expect(row).toHaveTextContent('Failed to load');
      expect(getLampOf('Reverb')).toHaveAccessibleDescription('Failed to load');
      expect(row).toHaveClass('unavailable');
      expect(row).not.toHaveClass('unsupported');

      await user.click(row);
      expect(addModule).toHaveBeenCalledTimes(2);
      expect(fx[0].$effects.value.reverb.added).toBe(true);
      await flush();
      expect(fx[0].$status.value.reverb).toBe('ready');
      expect(getRowOf('Reverb')).not.toHaveTextContent('Failed to load');
      expect(getRowOf('Reverb')).toHaveClass('on');
      expect(getLampOf('Reverb')).toHaveAttribute('aria-pressed', 'true');
    });

    it('a failed effect that is added: Retry loads it again and keeps it added', async () => {
      const addModule = failFirstWorkletLoad();
      const { fx, user } = setup();
      act(() => applySnapshot({ fx: { reverb: { a: true } } }));
      await flush();
      expect(fx[0].$status.value.reverb).toBe('failed');
      expect(getLampOf('Reverb')).toHaveAttribute('aria-pressed', 'true');
      expect(getRowOf('Reverb')).toHaveClass('on', 'unavailable');

      await user.click(screen.getByRole('button', { name: 'Retry Reverb' }));
      expect(addModule).toHaveBeenCalledTimes(2);
      expect(fx[0].$effects.value.reverb.added).toBe(true);
      await flush();
      expect(fx[0].$status.value.reverb).toBe('ready');
      expect(getRowOf('Reverb')).toHaveClass('on');
      expect(getRowOf('Reverb')).not.toHaveClass('unavailable');
      expect(screen.queryByRole('button', { name: 'Retry Reverb' })).not.toBeInTheDocument();
    });

    it('a failed effect that is added: a click on the row removes it without loading it again', async () => {
      const addModule = failFirstWorkletLoad();
      const { fx, user } = setup();
      act(() => applySnapshot({ fx: { reverb: { a: true } } }));
      await flush();
      await user.click(getRowOf('Reverb'));
      expect(fx[0].$effects.value.reverb.added).toBe(false);
      expect(fx[0].$status.value.reverb).toBe('failed');
      expect(addModule).toHaveBeenCalledTimes(1);
      expect(getLampOf('Reverb')).toHaveAttribute('aria-pressed', 'false');
    });

    it('Retry works from the keyboard and does not toggle the row', async () => {
      const addModule = failFirstWorkletLoad();
      const { fx, user } = setup();
      await flush();
      screen.getByRole('button', { name: 'Retry Reverb' }).focus();
      await user.keyboard('{Enter}');
      expect(addModule).toHaveBeenCalledTimes(2);
      await flush();
      expect(fx[0].$status.value.reverb).toBe('ready');
      expect(fx[0].$effects.value.reverb.added).toBe(false);
    });
  });
});
