const EDIT_TOKENS_KEY = 'presetEditTokens';

// secrets for editing presets saved from this browser, the server stores only their hashes
const readTokens = (): Record<string, string> => {
  try {
    const tokens = JSON.parse(localStorage.getItem(EDIT_TOKENS_KEY) ?? '{}');
    return tokens && typeof tokens === 'object' ? tokens : {};
  } catch (e) {
    return {};
  }
};

export const getEditToken = (id: string): string | undefined => readTokens()[id];

export const setEditToken = (id: string, token: string) =>
  localStorage.setItem(EDIT_TOKENS_KEY, JSON.stringify({ ...readTokens(), [id]: token }));
