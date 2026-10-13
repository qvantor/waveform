import { normalizePreset } from './normalize';
import { presetHash } from './hash';
import { isProfane } from './profanity';
import {
  listPresetsQuerySchema,
  nameKey,
  presetDataSchema,
  presetIdSchema,
  savePresetRequestSchema,
  updatePresetRequestSchema,
  usageRequestSchema,
} from './schema';

const preset = {
  osc1: { a: true, p: ['A', 'B', 'A/B/c.wav'], w: 3, o: -1, d: 12.5, u: 4, r: 0.001, g: 0.7 },
  osc2: { a: false, p: ['A', 'B', 'A/B/d.wav'], w: 0, o: 0, d: 5, u: 2, r: 0, g: 0.5 },
  filter: { a: true, t: 'bandpass', cut: 1234.5, res: 2, gain: 1 },
  adsr: { attack: 0.005, hold: 0.1, decay: 0, sustain: 1, release: 0.005 },
  v: { leg: false, port: 0, max: 8 },
  fx: {
    o: ['delay'],
    delay: { a: true, on: true, mix: 0.5, time: 0.25, fb: 0.3, mode: 1, pan: -0.01, freq: 800, q: 2 },
  },
};

const reversed = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, v]) => [key, v && typeof v === 'object' && !Array.isArray(v) ? reversed(v as any) : v])
  );

describe('presetHash', () => {
  it('gives the same hash for the same sound', () => {
    expect(presetHash(preset)).toBe(presetHash(JSON.parse(JSON.stringify(preset))));
  });

  it('ignores key order', () => {
    expect(presetHash(reversed(preset))).toBe(presetHash(preset));
  });

  it('ignores float noise below 4 significant digits', () => {
    const noisy = {
      ...preset,
      filter: { ...preset.filter, cut: 1234.50001 },
      adsr: { ...preset.adsr, attack: 0.0050000001 },
    };
    expect(presetHash(noisy)).toBe(presetHash(preset));
  });

  it('ignores unknown fields and name', () => {
    const extra = { ...preset, name: 'Other name', osc1: { ...preset.osc1, unknown: 1 } };
    expect(presetHash(extra)).toBe(presetHash(preset));
  });

  it('fills defaults, so an explicit default equals a missing field', () => {
    const { v, ...withoutVoicing } = preset;
    expect(v).toBeDefined();
    expect(presetHash(withoutVoicing)).toBe(presetHash(preset));
  });

  it('gives a different hash for a different sound', () => {
    expect(presetHash({ ...preset, osc1: { ...preset.osc1, w: 4 } })).not.toBe(presetHash(preset));
  });
});

describe('normalizePreset', () => {
  it('rounds numbers and sorts keys', () => {
    const normalized = normalizePreset({ ...preset, filter: { ...preset.filter, cut: 1234.5678 } });
    expect(normalized.filter.cut).toBe(1235);
    expect(Object.keys(normalized)).toEqual(['adsr', 'filter', 'fx', 'osc1', 'osc2', 'v']);
    expect(Object.keys(normalized.osc1)).toEqual(['a', 'd', 'g', 'o', 'p', 'r', 'u', 'w']);
  });

  it('keeps small values', () => {
    expect(normalizePreset({ ...preset, osc1: { ...preset.osc1, r: 0.00012346 } }).osc1.r).toBe(0.0001235);
  });

  it('fills fx defaults: every effect in the order, none in the chain', () => {
    const { fx } = normalizePreset({ ...preset, fx: undefined });
    expect(fx).toEqual({
      o: ['delay'],
      delay: { a: false, on: true, mix: 0.3, time: 0.2, fb: 0.5, mode: 0, pan: 0, freq: 1000, q: 0.01 },
    });
  });

  it('accepts the delay time and pan limits', () => {
    const delay = { ...preset.fx.delay, time: 1, pan: -0.05 };
    expect(normalizePreset({ ...preset, fx: { ...preset.fx, delay } }).fx.delay).toMatchObject({
      time: 1,
      pan: -0.05,
    });
  });

  it('drops unknown and duplicate effects from the order and appends the missing ones', () => {
    // e.g. a preset saved by a newer client with more effect types
    expect(
      normalizePreset({ ...preset, fx: { ...preset.fx, o: ['reverb', 'delay', 'delay'] } }).fx.o
    ).toEqual(['delay']);
    expect(normalizePreset({ ...preset, fx: { ...preset.fx, o: [] } }).fx.o).toEqual(['delay']);
  });

  it.each([
    ['out of range', { ...preset, osc1: { ...preset.osc1, u: 9 } }],
    ['not integer', { ...preset, osc1: { ...preset.osc1, o: 1.5 } }],
    ['wrong type', { ...preset, filter: { ...preset.filter, cut: '440' } }],
    ['unknown filter type', { ...preset, filter: { ...preset.filter, t: 'comb' } }],
    ['empty wavetable path', { ...preset, osc1: { ...preset.osc1, p: [] } }],
    ['NaN', { ...preset, adsr: { ...preset.adsr, attack: NaN } }],
    ['effect type not a string', { ...preset, fx: { ...preset.fx, o: [1] } }],
    [
      'delay feedback out of range',
      { ...preset, fx: { ...preset.fx, delay: { ...preset.fx.delay, fb: 1 } } },
    ],
    ['delay mode out of range', { ...preset, fx: { ...preset.fx, delay: { ...preset.fx.delay, mode: 2 } } }],
    ['delay mode not integer', { ...preset, fx: { ...preset.fx, delay: { ...preset.fx.delay, mode: 0.5 } } }],
    [
      'delay time out of range',
      { ...preset, fx: { ...preset.fx, delay: { ...preset.fx.delay, time: 1.1 } } },
    ],
    ['delay pan out of range', { ...preset, fx: { ...preset.fx, delay: { ...preset.fx.delay, pan: 0.06 } } }],
    ['delay q out of range', { ...preset, fx: { ...preset.fx, delay: { ...preset.fx.delay, q: 0.001 } } }],
    ['not an object', 'preset'],
  ])('rejects %s', (_, data) => {
    expect(() => normalizePreset(data)).toThrow();
    expect(presetDataSchema.safeParse(data).success).toBe(false);
  });
});

describe('requests', () => {
  it('validates preset name', () => {
    const base = { data: preset, turnstileToken: 'token' };
    expect(savePresetRequestSchema.parse({ ...base, name: '  Pad  ' }).name).toBe('Pad');
    expect(savePresetRequestSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(savePresetRequestSchema.safeParse({ ...base, name: 'x'.repeat(41) }).success).toBe(false);
    expect(savePresetRequestSchema.parse({ ...base, name: ' Deep \t  Pad ' }).name).toBe('Deep Pad');
    expect(
      savePresetRequestSchema.safeParse({ ...base, name: ` ${'x'.repeat(20)}   ${'x'.repeat(19)} ` }).success
    ).toBe(true);
    expect(
      savePresetRequestSchema.safeParse({ ...base, name: `${'x'.repeat(20)}   ${'x'.repeat(20)}` }).success
    ).toBe(false);
  });

  it('builds case-insensitive name key', () => {
    expect(nameKey('  Deep   PAD ')).toBe(nameKey('deep pad'));
  });

  it('validates update request', () => {
    const editToken = 'x'.repeat(43);
    expect(updatePresetRequestSchema.safeParse({ name: 'Pad', data: preset, editToken }).success).toBe(true);
    expect(
      updatePresetRequestSchema.safeParse({ name: 'Pad', data: preset, editToken: 'short' }).success
    ).toBe(false);
    expect(updatePresetRequestSchema.safeParse({ name: 'Pad', data: preset }).success).toBe(false);
  });

  it('caps usage seconds and items', () => {
    const presetId = '5b6a2f2e-4f7c-4c2a-9a39-6f1f3f0b2a11';
    expect(
      usageRequestSchema.parse({ clientId: 'c', items: [{ presetId, seconds: 500 }] }).items[0].seconds
    ).toBe(120);
    const items = Array.from({ length: 11 }, () => ({ presetId, seconds: 1 }));
    expect(usageRequestSchema.safeParse({ clientId: 'c', items }).success).toBe(false);
    expect(
      usageRequestSchema.safeParse({ clientId: 'c', items: [{ presetId: 'x', seconds: 1 }] }).success
    ).toBe(false);
  });

  it('accepts only uuid preset ids', () => {
    expect(presetIdSchema.safeParse('5b6a2f2e-4f7c-4c2a-9a39-6f1f3f0b2a11').success).toBe(true);
    expect(presetIdSchema.safeParse('42').success).toBe(false);
    expect(presetIdSchema.safeParse("1' or 1=1").success).toBe(false);
  });

  it('fills defaults for missing data and requires a captcha token', () => {
    const parsed = savePresetRequestSchema.parse({ name: 'Pad', data: {}, turnstileToken: 't' });
    expect(parsed.data).toEqual(presetDataSchema.parse({}));
    expect(savePresetRequestSchema.safeParse({ name: 'Pad', data: preset, turnstileToken: '' }).success).toBe(
      false
    );
    expect(savePresetRequestSchema.safeParse({ name: 'Pad', data: preset }).success).toBe(false);
  });

  it('parses list query with default sort and trimmed search', () => {
    expect(listPresetsQuerySchema.parse({})).toEqual({ sort: 'new' });
    expect(listPresetsQuerySchema.parse({ q: '  pad ', sort: 'popular', cursor: 'abc' })).toEqual({
      q: 'pad',
      sort: 'popular',
      cursor: 'abc',
    });
    expect(listPresetsQuerySchema.safeParse({ sort: 'random' }).success).toBe(false);
    expect(listPresetsQuerySchema.safeParse({ cursor: 'x'.repeat(513) }).success).toBe(false);
  });
});

describe('isProfane', () => {
  it.each(['fuck pad', 'Shit bass', 'хуевый бас', 'пиздец', 'ебаный лид', 'блядь', 'сука'])(
    'detects %s',
    (name) => {
      expect(isProfane(name)).toBe(true);
    }
  );

  it.each([
    'Deep Pad Night',
    'Hula lead',
    'Небесный пэд',
    'хлебами',
    'себе бас',
    'Худой бас',
    'Сукно',
    'Glass bells',
  ])('allows %s', (name) => {
    expect(isProfane(name)).toBe(false);
  });
});
