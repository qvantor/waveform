import { Preset, presetDataSchema } from '@waveform/preset-schema';

// a saved preset with the default sound
export const fakePreset = async (id: string): Promise<Preset> => ({
  id,
  name: `Preset ${id}`,
  data: presetDataSchema.parse({}),
  createdAt: '2026-01-01T00:00:00Z',
});
