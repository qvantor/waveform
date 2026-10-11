import { PresetData, presetDataSchema } from './schema';

const SIGNIFICANT_DIGITS = 4;

const roundNumber = (value: number) => (value === 0 ? 0 : Number(value.toPrecision(SIGNIFICANT_DIGITS)));

const normalizeValue = (value: unknown): unknown => {
  if (typeof value === 'number') return roundNumber(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object')
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((sum, key) => {
        sum[key] = normalizeValue((value as Record<string, unknown>)[key]);
        return sum;
      }, {});
  return value;
};

// validates (throws ZodError), fills defaults, drops unknown keys, rounds numbers and sorts keys
export const normalizePreset = (data: unknown): PresetData =>
  normalizeValue(presetDataSchema.parse(data)) as PresetData;
