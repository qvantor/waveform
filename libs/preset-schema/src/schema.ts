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

// effects of the fx rack, the order is the default chain order
export const FX_TYPES = ['distortion', 'delay', 'reverb'] as const;
export type FxType = typeof FX_TYPES[number];

// known types only, no duplicates (presets from a newer client may contain effect types this one doesn't
// know); a missing type (saved before it existed) takes its default place: before the first effect that
// comes after it in FX_TYPES, at the end if none does
export const normalizeFxOrder = (order: readonly unknown[]): FxType[] => {
  const known = order.filter(
    (type, i): type is FxType => FX_TYPES.includes(type as FxType) && order.indexOf(type) === i
  );
  return FX_TYPES.reduce<FxType[]>((result, type, index) => {
    if (result.includes(type)) return result;
    const next = result.findIndex((item) => FX_TYPES.indexOf(item) > index);
    return next === -1 ? [...result, type] : [...result.slice(0, next), type, ...result.slice(next)];
  }, known);
};

export interface ParamRange {
  min: number;
  max: number;
  default: number;
  int?: boolean;
}

// numeric fx params: knob ranges in the app, validation and defaults of presets
// the dry/wet mix of an effect (0: dry, 1: wet); delay and reverb are mixed into the dry sound
export const FX_MIX_PARAM: ParamRange = { min: 0, max: 1, default: 0.3 };
// the mix of each effect, the default is the one of a freshly added effect: the distortion replaces the dry
// sound
export const FX_MIX_PARAMS: Record<FxType, ParamRange> = {
  distortion: { ...FX_MIX_PARAM, default: 1 },
  delay: FX_MIX_PARAM,
  reverb: FX_MIX_PARAM,
};
export const FX_PARAMS = {
  // waveshaper, 4× oversampled
  distortion: {
    // the curve, an index into DISTORTION_MODES of the app (0: soft clip, 1: hard clip); new modes are
    // appended, so the saved indexes keep their meaning
    mode: { min: 0, max: 1, default: 0, int: true },
    // dB of gain into the curve; a makeup gain takes back the loudness it adds to a note. Up to 12: more
    // folds back audibly on high notes (4× oversampling)
    drive: { min: 0, max: 12, default: 8 },
    // lowpass after the curve, 20 kHz is open
    tone: { min: 500, max: 20000, default: 20000 },
    // dB of the output on top of the makeup gain (0: a note is about as loud as the dry one)
    level: { min: -24, max: 12, default: 0 },
  },
  delay: {
    time: { min: 0.01, max: 1, default: 0.2 },
    fb: { min: 0, max: 0.9, default: 0.5 },
    // 0: normal, 1: ping-pong
    mode: { min: 0, max: 1, default: 0, int: true },
    // stereo pan by delay (Haas effect, up to 50ms), < 0 delays the right channel (echoes on the left), > 0 the left one
    pan: { min: -0.05, max: 0.05, default: 0 },
    // bandpass in the feedback loop
    freq: { min: 50, max: 17000, default: 1000 },
    q: { min: 0.01, max: 3, default: 0.01 },
  },
  // algorithmic reverb
  reverb: {
    // input highpass, 20 Hz is effectively off
    lowcut: { min: 20, max: 1000, default: 20 },
    // seconds before the early reflections and the tail
    pre: { min: 0, max: 0.3, default: 0.02 },
    // room size: lengths of the reflections and the feedback lines
    size: { min: 0, max: 1, default: 0.5 },
    // RT60 in seconds of the mid frequencies
    decay: { min: 0.1, max: 20, default: 2 },
    // the high frequencies decay faster above this frequency
    damp: { min: 500, max: 20000, default: 6000 },
    // decay multiplier of the low frequencies (below 300 Hz)
    bass: { min: 0.25, max: 4, default: 1 },
    // modulation depth of the feedback lines (chorus of the tail)
    depth: { min: 0, max: 1, default: 0.2 },
    // stereo separation: 0 mono, 1 natural, 2 extra wide
    sep: { min: 0, max: 2, default: 1 },
    // level of the early reflections against the tail (the wet level is the common mix)
    er: { min: 0, max: 1, default: 0.5 },
    // vintage color of the input stage: 0 now (clean), 1 80s, 2 70s (tube drive, narrower bandwidth, more body)
    era: { min: 0, max: 2, default: 1, int: true },
  },
};

const range = (min: number, max: number) => z.number().finite().min(min).max(max);
const intRange = (min: number, max: number) => range(min, max).int();
const paramRange = ({ min, max, default: value, int }: ParamRange) =>
  (int ? intRange(min, max) : range(min, max)).default(value);
// legacy url params skip presetDataSchema: wrong types fall back to the default, numbers are clamped
// (and rounded for int params, the strict schema rejects fractions)
const lenientParamRange = ({ min, max, default: value, int }: ParamRange) =>
  z
    .number()
    .finite()
    .transform((num) => {
      const clamped = Math.min(max, Math.max(min, num));
      return int ? Math.round(clamped) : clamped;
    })
    .catch(value);
const mapParams = <K extends string, T>(params: Record<K, ParamRange>, toSchema: (param: ParamRange) => T) =>
  (Object.keys(params) as K[]).reduce(
    (acc, key) => ({ ...acc, [key]: toSchema(params[key]) }),
    {} as Record<K, T>
  );
const toObject = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};

// Phase rand of the presets saved before it was a share of the period: `r`, a start delay of 0..2 ms
export const LEGACY_RAND_PHASE_MAX = 0.002;
const legacyPhaseRand = (r: number) => Math.min(1, Math.max(0, r) / LEGACY_RAND_PHASE_MAX);

// the Phase of a new preset: half a period (180°); a legacy one (saved before Phase) keeps the phase it
// played from, the start of the wave
export const DEFAULT_PHASE = 0.5;
const LEGACY_PHASE = 0;

// a legacy `r` without `pr` becomes its pr (read only: it is not in the output), its ph is LEGACY_PHASE; the
// url snapshot of an oscillator skips the schema and calls it too
export const withLegacyPhase = <T extends { ph?: unknown; pr?: unknown }>(osc: T): T => {
  const { r } = osc as { r?: unknown };
  return osc.pr === undefined && typeof r === 'number'
    ? { ...osc, ph: osc.ph === undefined ? LEGACY_PHASE : osc.ph, pr: legacyPhaseRand(r) }
    : osc;
};

const oscillatorSchema = (active: boolean) =>
  z
    .preprocess(
      (value) =>
        typeof value === 'object' && value !== null && !Array.isArray(value) ? withLegacyPhase(value) : value,
      z
        .object({
          a: z.boolean().default(active),
          p: z.array(z.string().min(1).max(256)).min(1).max(5).default(DEFAULT_WAVETABLE_PATH),
          // the Wave knob: the position in frames, between two of them a morph
          w: range(0, 1023).default(0),
          o: intRange(-3, 3).default(0),
          d: range(0, 100).default(5),
          u: intRange(1, 8).default(2),
          // the start phase of every unison voice and the most of its random shift (0: all in phase, 1: any
          // phase): shares of a period
          ph: range(0, 1).default(DEFAULT_PHASE),
          pr: range(0, 1).default(1),
          r: range(0, LEGACY_RAND_PHASE_MAX).optional(),
          g: range(0, 1).default(0.5),
        })
        .transform((osc) => {
          const result: Omit<typeof osc, 'r'> & { r?: number } = { ...osc };
          delete result.r;
          return result as Omit<typeof osc, 'r'>;
        })
    )
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

// one shape for presets and url snapshots, only the validation of a value differs
const fxEffectShape = <K extends string, P, F>(
  params: Record<K, ParamRange>,
  mix: ParamRange,
  param: (range: ParamRange) => P,
  flag: (value: boolean) => F
) => ({
  a: flag(false), // in the chain
  on: flag(true), // not bypassed
  mix: param(mix),
  ...mapParams(params, param),
});

const fxSchema = z
  .object({
    o: z
      .array(z.string().max(64))
      .max(32)
      .transform(normalizeFxOrder)
      .default([...FX_TYPES]),
    distortion: z
      .object(
        fxEffectShape(FX_PARAMS.distortion, FX_MIX_PARAMS.distortion, paramRange, (value) =>
          z.boolean().default(value)
        )
      )
      .default({}),
    delay: z
      .object(
        fxEffectShape(FX_PARAMS.delay, FX_MIX_PARAMS.delay, paramRange, (value) => z.boolean().default(value))
      )
      .default({}),
    reverb: z
      .object(
        fxEffectShape(FX_PARAMS.reverb, FX_MIX_PARAMS.reverb, paramRange, (value) =>
          z.boolean().default(value)
        )
      )
      .default({}),
  })
  .default({});

const lenientFxEffect = <K extends string>(params: Record<K, ParamRange>, mix: ParamRange) =>
  z.preprocess(
    toObject,
    z.object(fxEffectShape(params, mix, lenientParamRange, (value) => z.boolean().catch(value)))
  );

// fx snapshot of the url: never fails, invalid values fall back to the defaults (see lenientParamRange)
export const fxSnapSchema = z.preprocess(
  toObject,
  z.object({
    o: z.array(z.unknown()).catch([]).transform(normalizeFxOrder),
    distortion: lenientFxEffect(FX_PARAMS.distortion, FX_MIX_PARAMS.distortion),
    delay: lenientFxEffect(FX_PARAMS.delay, FX_MIX_PARAMS.delay),
    reverb: lenientFxEffect(FX_PARAMS.reverb, FX_MIX_PARAMS.reverb),
  })
);

// keys match snapshot plugin model names (voicing is saved with the `v` prefix)
export const presetDataSchema = z.object({
  osc1: oscillatorSchema(true),
  osc2: oscillatorSchema(false),
  filter: filterSchema,
  adsr: adsrSchema,
  v: voicingSchema,
  fx: fxSchema,
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

// a Cloudflare Turnstile response, single use
const turnstileTokenSchema = z.string().min(1).max(4096);

export const savePresetRequestSchema = z.object({
  name: presetNameSchema,
  data: presetDataSchema,
  turnstileToken: turnstileTokenSchema,
});
export type SavePresetRequest = z.input<typeof savePresetRequestSchema>;

// the secret of the author (SavePresetResponse.editToken)
const editTokenSchema = z.string().min(20).max(128);

export const updatePresetRequestSchema = z.object({
  name: presetNameSchema,
  data: presetDataSchema,
  editToken: editTokenSchema,
});
export type UpdatePresetRequest = z.input<typeof updatePresetRequestSchema>;

// the author opened the preset, it is kept from the cleanup
export const presetOpenedRequestSchema = z.object({
  editToken: editTokenSchema,
});
export type PresetOpenedRequest = z.input<typeof presetOpenedRequestSchema>;

// a listen and a stay: a preset played this many seconds without switching to another one
export const USAGE_LISTEN_SECONDS = 10;
export const USAGE_STAY_SECONDS = 60;

// a listen: USAGE_LISTEN_SECONDS reached on a chosen preset; a stay: USAGE_STAY_SECONDS; each is sent once a preset
// is opened (see usePresetUsageTracker) with a captcha of its own, the score is the share of listeners who stayed
export const usageRequestSchema = z.object({
  presetId: presetIdSchema,
  event: z.enum(['listen', 'stay']),
  turnstileToken: turnstileTokenSchema,
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
