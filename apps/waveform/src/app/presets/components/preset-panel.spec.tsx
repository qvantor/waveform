import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { fakePreset } from '../../../test-utils/presets-fixtures';
import { renderWithPresets } from '../../../test-utils/presets-wrapper';
import { getPreset, sharePreset } from '../services';
import { PresetPanel } from './preset-panel';

jest.mock('../services', () => ({
  ...jest.requireActual('../services'),
  getPreset: jest.fn(),
  getTopPresets: jest.fn(() => new Promise(() => undefined)),
  isNameAvailable: jest.fn(() => new Promise(() => undefined)),
  sharePreset: jest.fn(),
}));

const getPresetMock = jest.mocked(getPreset);

const list = [
  { id: 'a', name: 'A', uniqueUsers: 0 },
  { id: 'b', name: 'B', uniqueUsers: 0 },
  { id: 'c', name: 'C', uniqueUsers: 0 },
];

// icon buttons have no labels, they go in this order
const buttons = (container: HTMLElement) => {
  const [prev, name, next, save, share] = Array.from(container.querySelectorAll('button'));
  return { prev, name, next, save, share };
};

const setup = () => {
  const user = userEvent.setup();
  const result = renderWithPresets(<PresetPanel />);
  return { ...result, user, buttons: buttons(result.container) };
};

beforeEach(() => {
  getPresetMock.mockImplementation(fakePreset);
});

describe('PresetPanel', () => {
  it('shows Init without a preset and the current preset name with a dirty mark', () => {
    const { buttons, presets } = setup();
    expect(buttons.name).toHaveTextContent(/^Init$/);

    act(() => presets[1].setSaved({ id: 'a', name: 'Bright pad' }));
    expect(buttons.name).toHaveTextContent(/^Bright pad$/);

    act(() => presets[0].$dirty.next(true));
    expect(buttons.name).toHaveTextContent(/^Bright pad \*$/);
  });

  it('disables ◀ ▶ without a list', () => {
    const { buttons } = setup();
    expect(buttons.prev).toBeDisabled();
    expect(buttons.next).toBeDisabled();
  });

  it('steps through the list with ◀ ▶', async () => {
    const { user, buttons, presets } = setup();
    act(() => presets[1].setList(list));
    expect(buttons.next).toBeEnabled();

    // nothing from the list is loaded yet, so ▶ starts from the first preset
    await user.click(buttons.next);
    await waitFor(() => expect(presets[0].$current.value?.id).toBe('a'));

    await user.click(buttons.prev);
    await waitFor(() => expect(presets[0].$current.value?.id).toBe('c'));
    expect(buttons.name).toHaveTextContent('Preset c');
  });

  it('opens the preset browser by the name', async () => {
    const { user, buttons } = setup();
    await user.click(buttons.name);
    expect(await screen.findByRole('dialog', { name: 'Presets' })).toBeInTheDocument();
  });

  it('opens the save dialog by the button and by Cmd/Ctrl+S', async () => {
    const { user, buttons } = setup();
    await user.click(buttons.save);
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
    setup();
    fireEvent.keyDown(document, { code: 'KeyS' });
    await act(() => Promise.resolve());
    expect(screen.queryByRole('dialog', { name: 'Save preset' })).not.toBeInTheDocument();
  });

  it('shares only a saved preset', async () => {
    const { user, buttons, presets } = setup();
    await user.click(buttons.share);
    expect(toast.error).toHaveBeenCalledWith('Save the preset first to share it');
    expect(sharePreset).not.toHaveBeenCalled();

    act(() => presets[1].setSaved({ id: 'a', name: 'Bright pad' }));
    await user.click(buttons.share);
    expect(sharePreset).toHaveBeenCalledWith('a');
  });
});
