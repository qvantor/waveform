import type {
  ApiError,
  NameAvailableResponse,
  Preset,
  PresetListItem,
  PresetOpenedRequest,
  PresetSort,
  PresetsPage,
  SavePresetRequest,
  SavePresetResponse,
  UpdatePresetRequest,
  UpdatePresetResponse,
  UsageRequest,
} from '@waveform/preset-schema';

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const body: Partial<ApiError> = await response.json().catch(() => ({}));
    throw new ApiRequestError(response.status, body.error ?? 'Something went wrong, try again');
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

export const getPreset = (id: string) => request<Preset>(`/api/presets/${encodeURIComponent(id)}`);

export const isNameAvailable = (name: string) =>
  request<NameAvailableResponse>(`/api/presets/name-available?${new URLSearchParams({ name })}`);

export const getTopPresets = () => request<PresetListItem[]>('/api/presets/top');

export const listPresets = ({
  q,
  sort,
  cursor,
}: {
  q?: string;
  sort: PresetSort;
  cursor?: string | null;
}) => {
  const params = new URLSearchParams({ sort });
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);
  return request<PresetsPage>(`/api/presets?${params}`);
};

export const savePreset = (body: SavePresetRequest) =>
  request<SavePresetResponse>('/api/presets', { method: 'POST', body: JSON.stringify(body) });

export const updatePreset = (id: string, body: UpdatePresetRequest) =>
  request<UpdatePresetResponse>(`/api/presets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

// the author opened own preset: it is kept from the cleanup
export const markPresetOpened = (id: string, body: PresetOpenedRequest) =>
  request<void>(`/api/presets/${encodeURIComponent(id)}/opened`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const reportPreset = (id: string) =>
  request<void>(`/api/presets/${encodeURIComponent(id)}/report`, { method: 'POST' });

// a listen or a stay of a preset; keepalive: the page may be closed right after it
export const sendUsage = (body: UsageRequest) =>
  request<void>('/api/usage', { method: 'POST', body: JSON.stringify(body), keepalive: true });
