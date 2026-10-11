import { z } from 'zod';

export const DEFAULT_WAVETABLE_PATH = [
  'ESW Core Tables',
  'Basics',
  'ESW Core Tables/Basics/ESW Basics - Saw Collection.wav',
];

export const FILTER_TYPES = [
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'peaking',
  'notch',
  'allpass',
] as const;

const range = (min: number, max: number) => z.number().finite().min(min).max(max);
const intRange = (min: number, max: number) => range(min, max).int();

const oscillatorSchema = (active: boolean) =>
  z
    .object({
      a: z.boolean().default(active),
      p: z.array(z.string().min(1).max(256)).min(1).max(5).default(DEFAULT_WAVETABLE_PATH),
      w: intRange(0, 1023).default(0),
      o: intRange(-3, 3).default(0),
      d: range(0, 100).default(5),
      u: intRange(1, 8).default(2),
      r: range(0, 0.002).default(0),
      g: range(0, 1).default(0.5),
    })
    .default({});

const filterSchema = z
  .object({
    a: z.boolean().default(false),
    t: z.enum(FILTER_TYPES).default('lowpass'),
    cut: range(10, 22050).default(440),
    res: range(0, 1000).default(0),
    gain: range(-40, 40).default(1),
  })
  .default({});

const adsrSchema = z
  .object({
    attack: range(0, 1).default(0.005),
    hold: range(0, 1).default(0.1),
    decay: range(0, 1).default(0),
    sustain: range(0, 1).default(1),
    release: range(0, 1).default(0.005),
  })
  .default({});

const voicingSchema = z
  .object({
    leg: z.boolean().default(false),
    port: range(0, 400).default(0),
    max: intRange(1, 12).default(8),
  })
  .default({});

// keys match snapshot plugin model names (voicing is saved with the `v` prefix)
export const presetDataSchema = z.object({
  osc1: oscillatorSchema(true),
  osc2: oscillatorSchema(false),
  filter: filterSchema,
  adsr: adsrSchema,
  v: voicingSchema,
});

export type PresetData = z.infer<typeof presetDataSchema>;

export const PRESET_NAME_MAX_LENGTH = 40;

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ');

// trimmed, whitespace collapsed; names are unique case-insensitively (see nameKey)
export const presetNameSchema = z
  .string()
  .transform(normalizeName)
  .pipe(z.string().min(1).max(PRESET_NAME_MAX_LENGTH));

export const nameKey = (name: string) => normalizeName(name).toLowerCase();

export const presetIdSchema = z.string().uuid();

export const savePresetRequestSchema = z.object({
  name: presetNameSchema,
  data: presetDataSchema,
  turnstileToken: z.string().min(1).max(4096),
});
export type SavePresetRequest = z.input<typeof savePresetRequestSchema>;

export const updatePresetRequestSchema = z.object({
  name: presetNameSchema,
  data: presetDataSchema,
  editToken: z.string().min(20).max(128),
});
export type UpdatePresetRequest = z.input<typeof updatePresetRequestSchema>;

export const USAGE_MAX_ITEMS = 10;
export const USAGE_MAX_SECONDS = 120;

export const usageRequestSchema = z.object({
  clientId: z.string().min(1).max(64),
  items: z
    .array(
      z.object({
        presetId: presetIdSchema,
        seconds: z
          .number()
          .int()
          .min(1)
          .transform((value) => Math.min(value, USAGE_MAX_SECONDS)),
      })
    )
    .min(1)
    .max(USAGE_MAX_ITEMS),
});
export type UsageRequest = z.input<typeof usageRequestSchema>;

export const PRESET_SORTS = ['new', 'name', 'popular'] as const;
export type PresetSort = typeof PRESET_SORTS[number];

export const listPresetsQuerySchema = z.object({
  q: z.string().trim().max(PRESET_NAME_MAX_LENGTH).optional(),
  sort: z.enum(PRESET_SORTS).default('new'),
  cursor: z.string().max(512).optional(),
});

// API responses
export interface PresetListItem {
  id: string;
  name: string;
  uniqueUsers: number;
}

export interface Preset {
  id: string;
  name: string;
  data: PresetData;
  createdAt: string;
}

export interface PresetsPage {
  items: PresetListItem[];
  nextCursor: string | null;
}

export interface SavePresetResponse {
  id: string;
  name: string;
  existed: boolean;
  // secret for editing the preset later, only returned when the preset was created
  editToken?: string;
}

export interface NameAvailableResponse {
  available: boolean;
}

export interface UpdatePresetResponse {
  id: string;
  name: string;
}

export interface ApiError {
  error: string;
}
