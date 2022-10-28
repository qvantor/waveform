export const isRecord = (value: unknown): value is Record<string | number, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
