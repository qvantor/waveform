import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { fakePreset } from '../../../test-utils/presets-fixtures';
import { renderWithPresets } from '../../../test-utils/presets-wrapper';
import { getPreset, getTopPresets, sharePreset } from '../services';
import { PresetSection } from './preset-section';

jest.mock('../services', () => ({
  ...jest.requireActual('../services'),
  getPreset: jest.fn(),
  getTopPresets: jest.fn(() => new Promise(() => undefined)),
  isNameAvailable: jest.fn(() => new Promise(() => undefined)),
  sharePreset: jest.fn(),
}));

const getPresetMock = jest.mocked(getPreset);
const getTopPresetsMock = jest.mocked(getTopPresets);

const list = [
  { id: 'a', name: 'A', uniqueUsers: 0 },
  { id: 'b', name: 'B', uniqueUsers: 0 },
  { id: 'c', name: 'C', uniqueUsers: 0 },
];

beforeEach(() => {
  getPresetMock.mockImplementation(fakePreset);
});

describe('PresetSection', () => {
  const setupSection = (actions?: React.ReactNode) => {
    const user = userEvent.setup();
    const result = renderWithPresets(<PresetSection actions={actions} />);
    const prev = screen.getByRole('button', { name: 'Previous preset' });
    const next = screen.getByRole('button', { name: 'Next preset' });
    // the name sits between ◀ and ▶
    const name = prev.nextElementSibling as HTMLElement;
    return { ...result, user, prev, next, name };
  };

  it('shows Init without a preset and the current preset name with a dirty mark', () => {
    const { name, presets } = setupSection();
    expect(name).toHaveTextContent(/^Init$/);

    act(() => presets[1].setSaved({ id: 'a', name: 'Bright pad' }));
    expect(name).toHaveTextContent(/^Bright pad$/);

    act(() => presets[0].$dirty.next(true));
    expect(name).toHaveTextContent(/^Bright pad \*$/);
  });

  it('steps through the popular presets loaded on start from Init', async () => {
    getTopPresetsMock.mockResolvedValueOnce(list);
    const { user, prev, next, name, presets } = setupSection();
    expect(prev).toBeEnabled();
    expect(next).toBeEnabled();
    await waitFor(() => expect(presets[0].$top.value).toEqual(list));

    await user.click(next);
    await waitFor(() => expect(presets[0].$current.value?.id).toBe('a'));
    await user.click(prev);
    await waitFor(() => expect(presets[0].$current.value?.id).toBe('c'));
    expect(name).toHaveTextContent('Preset c');
    expect(getTopPresetsMock).toHaveBeenCalledTimes(1);
  });

  it('opens the preset browser by the name', async () => {
    const { user, name } = setupSection();
    await user.click(name);
    expect(await screen.findByRole('dialog', { name: 'Presets' })).toBeInTheDocument();
  });

  it('opens the save dialog by Save and by Cmd/Ctrl+S', async () => {
    const { user } = setupSection();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('dialog', { name: 'Save preset' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Save preset' })).not.toBeInTheDocument()
    );

    const event = new KeyboardEvent('keydown', {
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(await screen.findByRole('dialog', { name: 'Save preset' })).toBeInTheDocument();
    // the browser's own "save page" is suppressed
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not open the save dialog for a plain S', async () => {
    setupSection();
    fireEvent.keyDown(document, { code: 'KeyS' });
    await act(() => Promise.resolve());
    expect(screen.queryByRole('dialog', { name: 'Save preset' })).not.toBeInTheDocument();
  });

  it('shares only a saved preset', async () => {
    const { user, presets } = setupSection();
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(toast.error).toHaveBeenCalledWith('Save the preset first to share it');
    expect(sharePreset).not.toHaveBeenCalled();

    act(() => presets[1].setSaved({ id: 'a', name: 'Bright pad' }));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(sharePreset).toHaveBeenCalledWith('a');
  });

  it('renders extra actions after Save and Share', () => {
    setupSection(<button type='button'>Extra</button>);
    const extra = screen.getByRole('button', { name: 'Extra' });
    expect(screen.getByRole('button', { name: 'Share' }).nextElementSibling).toBe(extra);
  });
});
