import toast from 'react-hot-toast';
import { clearUrlPresetId, getUrlPresetId, presetUrl, setUrlPresetId, sharePreset } from './url';

describe('url', () => {
  it('reads the preset id from the search params', () => {
    expect(getUrlPresetId()).toBeNull();
    window.history.replaceState(null, '', '/?preset=abc');
    expect(getUrlPresetId()).toBe('abc');
  });

  it('builds a preset url without other params', () => {
    window.history.replaceState(null, '', '/synth?osc1-u=3#x');
    expect(presetUrl('a b')).toBe(`${window.location.origin}/synth?preset=a+b`);
  });

  it('replaces the url with the preset id', () => {
    window.history.replaceState(null, '', '/?osc1-u=3');
    const length = window.history.length;
    setUrlPresetId('xyz');
    expect(window.location.search).toBe('?preset=xyz');
    expect(window.history.length).toBe(length);
  });

  it('clears the preset id and the legacy params', () => {
    window.history.replaceState(null, '', '/synth?preset=xyz&osc1-u=3');
    const length = window.history.length;
    clearUrlPresetId();
    expect(window.location.pathname).toBe('/synth');
    expect(window.location.search).toBe('');
    expect(window.history.length).toBe(length);
  });

  describe('sharePreset', () => {
    const writeText = jest.fn();
    beforeEach(() => {
      Object.assign(navigator, { clipboard: { writeText } });
    });

    it('copies the preset url', async () => {
      writeText.mockResolvedValue(undefined);
      await sharePreset('id1');
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?preset=id1`);
      expect(toast.success).toHaveBeenCalled();
    });

    it('shows an error when the clipboard is unavailable', async () => {
      writeText.mockRejectedValue(new Error('denied'));
      await sharePreset('id1');
      expect(toast.error).toHaveBeenCalledWith('Could not copy the link');
    });
  });
});
