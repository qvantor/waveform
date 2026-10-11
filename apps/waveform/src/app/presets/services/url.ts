import toast from 'react-hot-toast';

const PRESET_PARAM = 'preset';

export const getUrlPresetId = () => new URLSearchParams(window.location.search).get(PRESET_PARAM);

export const presetUrl = (id: string) => {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set(PRESET_PARAM, id);
  return url.toString();
};

// replaces legacy snapshot search params too, the preset id is the only state in url now
export const setUrlPresetId = (id: string) => window.history.replaceState(null, '', presetUrl(id));

export const sharePreset = (id: string) =>
  navigator.clipboard
    .writeText(presetUrl(id))
    .then(() => toast.success('Link copied to the clipboard'))
    .catch(() => toast.error('Could not copy the link'));
