import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithPresets } from '../../../test-utils/presets-wrapper';
import {
  ApiRequestError,
  getEditToken,
  isNameAvailable,
  savePreset,
  setEditToken,
  updatePreset,
} from '../services';
import { SaveDialog } from './save-dialog';

jest.mock('../services', () => ({
  ...jest.requireActual('../services'),
  getPreset: jest.fn(),
  isNameAvailable: jest.fn(),
  savePreset: jest.fn(),
  updatePreset: jest.fn(),
  sharePreset: jest.fn(),
}));

const isNameAvailableMock = jest.mocked(isNameAvailable);
const savePresetMock = jest.mocked(savePreset);
const updatePresetMock = jest.mocked(updatePreset);

const setup = () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const onClose = jest.fn();
  const result = renderWithPresets(<SaveDialog open onClose={onClose} />);
  return { ...result, user, onClose };
};

const nameInput = () => screen.getByPlaceholderText('Preset name');

const submit = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(nameInput(), 'Bright pad');
  await user.click(screen.getByRole('button', { name: 'Pass captcha' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
};

// debounces run on fake timers, waitFor/findBy advance them
beforeEach(() => {
  jest.useFakeTimers();
  isNameAvailableMock.mockResolvedValue({ available: true });
});
afterEach(() => jest.useRealTimers());

describe('SaveDialog', () => {
  it('waits for the captcha before saving', async () => {
    const { user } = setup();
    await user.type(nameInput(), 'Bright pad');
    expect(screen.getByRole('button', { name: 'Checking...' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Pass captcha' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('checks the name availability after typing stops', async () => {
    isNameAvailableMock.mockResolvedValue({ available: false });
    const { user } = setup();
    await user.type(nameInput(), 'Taken  Name');
    await user.click(screen.getByRole('button', { name: 'Pass captcha' }));

    expect(await screen.findByText('Name is already taken')).toBeInTheDocument();
    // checked once, with the normalized name, not on every keystroke
    expect(isNameAvailableMock).toHaveBeenCalledTimes(1);
    expect(isNameAvailableMock).toHaveBeenCalledWith('taken name');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves a new preset, stores its edit token and makes it current', async () => {
    savePresetMock.mockResolvedValue({ id: 'p1', name: 'Bright pad', existed: false, editToken: 'secret' });
    const { user, presets } = setup();
    await submit(user);

    expect(await screen.findByText('“Bright pad” has been saved.')).toBeInTheDocument();
    expect(savePresetMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bright pad', turnstileToken: 'captcha-token' })
    );
    expect(getEditToken('p1')).toBe('secret');
    expect(presets[0].$current.value).toEqual({ id: 'p1', name: 'Bright pad' });
    expect(screen.getByDisplayValue('http://localhost/?preset=p1')).toBeInTheDocument();
  });

  it('tells when the same sound is already saved', async () => {
    savePresetMock.mockResolvedValue({ id: 'p0', name: 'Old one', existed: true });
    const { user } = setup();
    await submit(user);

    expect(await screen.findByText('This sound is already saved as “Old one”.')).toBeInTheDocument();
    expect(getEditToken('p0')).toBeUndefined();
  });

  it('shows the server error and rechecks the name on conflict', async () => {
    savePresetMock.mockRejectedValue(new ApiRequestError(409, 'Name is already taken'));
    const { user } = setup();
    await user.type(nameInput(), 'Bright pad');
    await waitFor(() => expect(isNameAvailableMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Pass captcha' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Name is already taken'));
    await waitFor(() => expect(isNameAvailableMock).toHaveBeenCalledTimes(2));
    // the captcha token is single use
    expect(await screen.findByRole('button', { name: 'Checking...' })).toBeDisabled();
  });

  it('shows rate limit errors', async () => {
    savePresetMock.mockRejectedValue(new ApiRequestError(429, 'Too many presets, try again later'));
    const { user } = setup();
    await submit(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too many presets, try again later'));
  });

  it('explains captcha errors and offers a retry', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Fail captcha' }));
    expect(screen.getByText(/Captcha is not allowed on localhost/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByText(/Captcha is not allowed/)).not.toBeInTheDocument();
  });

  describe('preset saved from this browser', () => {
    const renderEditable = () => {
      setEditToken('p1', 'secret');
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const result = renderWithPresets(<SaveDialog open={false} onClose={jest.fn()} />);
      act(() => result.presets[1].setSaved({ id: 'p1', name: 'Bright pad' }));
      result.rerender(<SaveDialog open onClose={jest.fn()} />);
      return { ...result, user };
    };

    it('overwrites the current preset with its edit token', async () => {
      updatePresetMock.mockResolvedValue({ id: 'p1', name: 'Brighter pad' });
      const { user, presets } = renderEditable();
      expect(nameInput()).toHaveValue('Bright pad');
      expect(screen.getByText(/Save overwrites “Bright pad”/)).toBeInTheDocument();

      await user.clear(nameInput());
      await user.type(nameInput(), 'Brighter pad');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('“Brighter pad” has been updated.')).toBeInTheDocument();
      expect(updatePresetMock).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ name: 'Brighter pad', editToken: 'secret' })
      );
      expect(presets[0].$current.value).toEqual({ id: 'p1', name: 'Brighter pad' });
      expect(savePresetMock).not.toHaveBeenCalled();
    });

    it('does not check its own name and requires a new name to save as new', async () => {
      const { user } = renderEditable();
      await user.click(screen.getByRole('button', { name: 'Pass captcha' }));

      expect(screen.getByRole('button', { name: 'Save as new' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(isNameAvailableMock).not.toHaveBeenCalled();
    });
  });
});
