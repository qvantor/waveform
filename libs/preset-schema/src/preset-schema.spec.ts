import { normalizePreset } from './normalize';
import { presetHash } from './hash';
import { isProfane } from './profanity';
import {
  ENVELOPE_CURVES,
  fxSnapSchema,
  listPresetsQuerySchema,
  nameKey,
  presetDataSchema,
  presetIdSchema,
  presetOpenedRequestSchema,
  savePresetRequestSchema,
  updatePresetRequestSchema,
  usageRequestSchema,
} from './schema';

const preset = {
  osc1: { a: true, p: ['A', 'B', 'A/B/c.wav'], w: 3, o: -1, d: 12.5, u: 4, ph: 0.25, pr: 0.5, g: 0.7 },
  osc2: { a: false, p: ['A', 'B', 'A/B/d.wav'], w: 0, o: 0, d: 5, u: 2, ph: 0, pr: 0, g: 0.5 },
  filter: { a: true, t: 'bandpass', cut: 1234.5, res: 2, gain: 1 },
  env: {
    e1: { attack: 0.005, hold: 0.1, decay: 0, sustain: 1, release: 0.005 },
    e2: { attack: 0.01, hold: 0, decay: 2.5, sustain: 0, release: 0.3 },
    e3: { attack: 0.005, hold: 0, decay: 0.5, sustain: 0, release: 0.3 },
  },
  mod: { 'env2:osc1.wave': 0.5, 'env1:filter.cutoff': -0.25, 'env3:delay.time': 0 },
  v: { leg: false, port: 0, max: 8 },
  fx: {
    o: ['reverb', 'delay'],
    delay: { a: true, on: true, mix: 0.5, time: 0.25, fb: 0.3, mode: 1, pan: -0.01, freq: 800, q: 2 },
    reverb: {
      a: true,
      on: true,
      mix: 0.3,
      lowcut: 80,
      pre: 0.01,
      size: 0.4,
      decay: 1.5,
      damp: 5000,
      bass: 1.2,
      depth: 0.2,
      sep: 1,
      er: 0.5,
      era: 2,
    },
  },
};

const DELAY_DEFAULTS = {
  a: false,
  on: true,
  mix: 0.3,
  time: 0.2,
  fb: 0.5,
  mode: 0,
  pan: 0,
  freq: 1000,
  q: 0.01,
};
const REVERB_DEFAULTS = {
  a: false,
  on: true,
  mix: 0.3,
  lowcut: 20,
  pre: 0.02,
  size: 0.5,
  decay: 2,
  damp: 6000,
  bass: 1,
  depth: 0.2,
  sep: 1,
  er: 0.5,
  era: 1,
};
// all wet, unlike the delay and the reverb
const DISTORTION_DEFAULTS = { a: false, on: true, mix: 1, mode: 0, drive: 8, tone: 20000, level: 0 };

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
      env: { ...preset.env, e1: { ...preset.env.e1, attack: 0.0050000001 } },
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
    expect(Object.keys(normalized)).toEqual(['env', 'filter', 'fx', 'mod', 'osc1', 'osc2', 'v']);
    expect(Object.keys(normalized.osc1)).toEqual(['a', 'd', 'g', 'o', 'p', 'ph', 'pr', 'u', 'w']);
  });

  it('fills each envelope with its own defaults, takes stages up to 32 s and drops the old adsr', () => {
    const { env } = normalizePreset({ adsr: { attack: 0.5 }, env: { e2: { decay: 32, release: 0 } } });
    const curves = { attack: 0, decay: 3.49, release: 3.49 };
    expect(env).toEqual({
      e1: { attack: 0.005, hold: 0.1, decay: 0, sustain: 1, release: 0.005, curves },
      e2: { attack: 0.005, hold: 0, decay: 32, sustain: 0, release: 0, curves },
      e3: { attack: 0.005, hold: 0, decay: 0.5, sustain: 0, release: 0.3, curves },
      vel: { amp: 1, k: 0 },
    });
    expect(normalizePreset({ adsr: { attack: 0.5 } })).not.toHaveProperty('adsr');
  });

  it('curves the stages of an envelope by default, keeps its own up to ±10, 0 too', () => {
    expect(normalizePreset({}).env.e2.curves).toEqual(ENVELOPE_CURVES);
    const { env } = normalizePreset({ env: { e2: { curves: { attack: -10, release: 0 } } } });
    expect(env.e2.curves).toEqual({ attack: -10, decay: 3.49, release: 0 });
    expect(env.e1.curves).toEqual(ENVELOPE_CURVES);
  });

  it('puts the curves on the grid of the points of the chart: a k near 0 is a line (its shape would be 0/0)', () => {
    const { env } = normalizePreset({
      env: { e1: { curves: { attack: 0.004, decay: 1e-17, release: 2.346 } } },
    });
    expect(env.e1.curves).toEqual({ attack: 0, decay: 0, release: 2.35 });
    expect(presetHash({ env: { e1: { curves: { decay: 1e-17 } } } })).toBe(
      presetHash({ env: { e1: { curves: { decay: 0 } } } })
    );
  });

  it('keeps the routes of the modulation with their amounts, 0 too; none by default', () => {
    expect(normalizePreset(preset).mod).toEqual(preset.mod);
    expect(normalizePreset({}).mod).toEqual({});
    expect(
      Object.keys(normalizePreset({ mod: { 'env3:osc2.gain': 1, 'env1:osc1.detune': -1 } }).mod)
    ).toEqual(['env1:osc1.detune', 'env3:osc2.gain']);
  });

  it('gives the velocity a line and Amp 1 by default, keeps Amp 0 and a curve on the grid within ±10', () => {
    expect(normalizePreset({}).env.vel).toEqual({ amp: 1, k: 0 });
    expect(normalizePreset({ env: { vel: { amp: 0 } } }).env.vel).toEqual({ amp: 0, k: 0 });
    expect(normalizePreset({ env: { vel: { amp: 0.5, k: -3.456 } } }).env.vel).toEqual({
      amp: 0.5,
      k: -3.46,
    });
  });

  it('takes routes of the velocity (VELO) as those of an envelope', () => {
    const mod = { 'velo:filter.cutoff': 0.5, 'env2:filter.cutoff': -0.25, 'velo:delay.mix': 1 };
    expect(normalizePreset({ mod }).mod).toEqual(mod);
  });

  it('fills the range of the pitch bend with 2 semitones down and up, keeps 0..48', () => {
    expect(normalizePreset({}).v).toMatchObject({ bd: 2, bu: 2 });
    expect(normalizePreset({ v: { bd: 0, bu: 48 } }).v).toMatchObject({ bd: 0, bu: 48 });
  });

  it('keeps small values', () => {
    expect(normalizePreset({ ...preset, osc1: { ...preset.osc1, pr: 0.00012346 } }).osc1.pr).toBe(0.0001235);
  });

  it('fills Phase with 0.5 (180°) and Phase rand with 1, keeps 0 and accepts 0..1', () => {
    const { osc1, osc2 } = normalizePreset({
      ...preset,
      osc1: { ...preset.osc1, ph: undefined, pr: undefined },
      osc2: { ...preset.osc2, ph: 1, pr: 1 },
    });
    expect([osc1.ph, osc1.pr, osc2.ph, osc2.pr]).toEqual([0.5, 1, 1, 1]);
    expect(normalizePreset({}).osc1).toMatchObject({ ph: 0.5, pr: 1 });
    expect(normalizePreset(preset).osc2).toMatchObject({ ph: 0, pr: 0 });
  });

  it('reads the Phase rand of a legacy preset from r (seconds up to 2 ms), writes only pr', () => {
    const legacy = { ...preset, osc1: { ...preset.osc1, pr: undefined, r: 0.0005 } };
    const { osc1, osc2 } = normalizePreset({ ...legacy, osc2: { ...preset.osc2, pr: undefined, r: 0 } });
    expect(osc1.pr).toBe(0.25);
    expect(osc2.pr).toBe(0);
    expect(osc1).not.toHaveProperty('r');
    // pr wins over r
    expect(normalizePreset({ ...preset, osc1: { ...preset.osc1, r: 0.002 } }).osc1.pr).toBe(0.5);
    expect(presetDataSchema.safeParse({ ...legacy, osc1: { ...legacy.osc1, r: 0.003 } }).success).toBe(false);
  });

  it('keeps a legacy preset (r without pr) at the phase it played from, 0, not the default', () => {
    const legacy = { ...preset, osc1: { ...preset.osc1, ph: undefined, pr: undefined, r: 0 } };
    expect(normalizePreset(legacy).osc1.ph).toBe(0);
    expect(normalizePreset({ ...legacy, osc1: { ...legacy.osc1, ph: 0.25 } }).osc1.ph).toBe(0.25);
    // with pr it is not legacy
    expect(normalizePreset({ ...legacy, osc1: { ...legacy.osc1, pr: 0 } }).osc1.ph).toBe(0.5);
  });

  it('keeps a position between two frames, with 4 significant digits', () => {
    expect(normalizePreset({ ...preset, osc1: { ...preset.osc1, w: 12.4 } }).osc1.w).toBe(12.4);
    expect(normalizePreset({ ...preset, osc1: { ...preset.osc1, w: 123.45 } }).osc1.w).toBe(123.5);
    expect(presetHash({ ...preset, osc1: { ...preset.osc1, w: 3 } })).toBe(presetHash(preset));
  });

  it('fills fx defaults: every effect in the order, none in the chain', () => {
    const { fx } = normalizePreset({ ...preset, fx: undefined });
    expect(fx).toEqual({
      o: ['distortion', 'delay', 'reverb'],
      distortion: DISTORTION_DEFAULTS,
      delay: DELAY_DEFAULTS,
      reverb: REVERB_DEFAULTS,
    });
  });

  it('fills reverb defaults for a preset saved before the reverb', () => {
    const { reverb, ...fx } = preset.fx;
    expect(reverb).toBeDefined();
    const normalized = normalizePreset({ ...preset, fx: { ...fx, o: ['delay'] } }).fx;
    expect(normalized.o).toEqual(['distortion', 'delay', 'reverb']);
    expect(normalized.reverb).toEqual(REVERB_DEFAULTS);
    expect(normalized.delay).toEqual(preset.fx.delay);
  });

  it('fills distortion defaults for a preset saved before the distortion, puts it first in the order', () => {
    expect(preset.fx).not.toHaveProperty('distortion');
    const normalized = normalizePreset(preset).fx;
    expect(normalized.distortion).toEqual(DISTORTION_DEFAULTS);
    expect(normalized.o).toEqual(['distortion', 'reverb', 'delay']);
    expect(normalized.delay).toEqual(preset.fx.delay);
    expect(normalized.reverb).toEqual(preset.fx.reverb);
  });

  it('keeps the distortion params and accepts their limits', () => {
    [
      { a: true, on: false, mix: 0, mode: 0, drive: 0, tone: 500, level: -24 },
      { a: true, on: true, mix: 1, mode: 1, drive: 12, tone: 20000, level: 12 },
    ].forEach((distortion) =>
      expect(normalizePreset({ ...preset, fx: { ...preset.fx, distortion } }).fx.distortion).toEqual(
        distortion
      )
    );
  });

  it.each([
    ['a mode out of range', { mode: 2 }],
    ['a fractional mode', { mode: 0.5 }],
    ['too much drive', { drive: 13 }],
    ['a tone below its range', { tone: 400 }],
    ['a level above its range', { level: 13 }],
  ])('rejects %s', (_, distortion) => {
    expect(() => normalizePreset({ ...preset, fx: { ...preset.fx, distortion } })).toThrow();
  });

  it('strips the reverb params removed later (high cut, diffusion, crossover, mod speed)', () => {
    const reverb = { ...preset.fx.reverb, highcut: 8000, diff: 0.2, xover: 500, speed: 2 };
    expect(normalizePreset({ ...preset, fx: { ...preset.fx, reverb } }).fx.reverb).toEqual(preset.fx.reverb);
  });

  it('keeps the reverb params and accepts their limits', () => {
    expect(normalizePreset(preset).fx.reverb).toEqual(preset.fx.reverb);
    const min = { lowcut: 20, pre: 0, size: 0, decay: 0.1, damp: 500, bass: 0.25 };
    const max = { lowcut: 1000, pre: 0.3, size: 1, decay: 20, damp: 20000, bass: 4 };
    const more = { depth: 0, sep: 0, er: 0, era: 0, mix: 0 };
    const most = { depth: 1, sep: 2, er: 1, era: 2, mix: 1 };
    [
      { ...min, ...more },
      { ...max, ...most },
    ].forEach((limits) => {
      const reverb = { ...preset.fx.reverb, ...limits };
      expect(normalizePreset({ ...preset, fx: { ...preset.fx, reverb } }).fx.reverb).toEqual(reverb);
    });
  });

  it('accepts the delay time and pan limits', () => {
    const delay = { ...preset.fx.delay, time: 1, pan: -0.05 };
    expect(normalizePreset({ ...preset, fx: { ...preset.fx, delay } }).fx.delay).toMatchObject({
      time: 1,
      pan: -0.05,
    });
  });

  it('drops unknown and duplicate effects from the order, a missing one takes its default place', () => {
    const order = (o: string[]) => normalizePreset({ ...preset, fx: { ...preset.fx, o } }).fx.o;
    // e.g. a preset saved by a newer client with more effect types
    expect(order(['chorus', 'reverb', 'delay', 'delay'])).toEqual(['distortion', 'reverb', 'delay']);
    expect(order([])).toEqual(['distortion', 'delay', 'reverb']);
    // before the first effect that comes after it by default, at the end if none does
    expect(order(['reverb'])).toEqual(['distortion', 'delay', 'reverb']);
    expect(order(['delay', 'distortion'])).toEqual(['delay', 'distortion', 'reverb']);
    expect(order(['reverb', 'distortion'])).toEqual(['delay', 'reverb', 'distortion']);
  });

  it.each([
    ['out of range', { ...preset, osc1: { ...preset.osc1, u: 9 } }],
    ['phase out of range', { ...preset, osc1: { ...preset.osc1, ph: 1.1 } }],
    ['phase rand out of range', { ...preset, osc2: { ...preset.osc2, pr: -0.1 } }],
    ['position out of range', { ...preset, osc1: { ...preset.osc1, w: 1024 } }],
    ['not integer', { ...preset, osc1: { ...preset.osc1, o: 1.5 } }],
    ['wrong type', { ...preset, filter: { ...preset.filter, cut: '440' } }],
    ['unknown filter type', { ...preset, filter: { ...preset.filter, t: 'comb' } }],
    ['empty wavetable path', { ...preset, osc1: { ...preset.osc1, p: [] } }],
    ['NaN', { ...preset, env: { ...preset.env, e1: { ...preset.env.e1, attack: NaN } } }],
    ['envelope time over 32 s', { ...preset, env: { ...preset.env, e2: { ...preset.env.e2, release: 33 } } }],
    ['sustain over 1', { ...preset, env: { ...preset.env, e3: { ...preset.env.e3, sustain: 1.5 } } }],
    [
      'curve over 10',
      { ...preset, env: { ...preset.env, e3: { ...preset.env.e3, curves: { decay: 10.5 } } } },
    ],
    ['pitch bend range over 48', { ...preset, v: { ...preset.v, bu: 49 } }],
    ['pitch bend range not integer', { ...preset, v: { ...preset.v, bd: 1.5 } }],
    ['mod amount over 1', { ...preset, mod: { 'env2:osc1.wave': 1.5 } }],
    ['mod source unknown', { ...preset, mod: { 'lfo1:osc1.wave': 0.5 } }],
    ['velocity amp over 1', { ...preset, env: { ...preset.env, vel: { amp: 1.5 } } }],
    ['velocity curve over 10', { ...preset, env: { ...preset.env, vel: { k: -11 } } }],
    ['mod key without a target', { ...preset, mod: { env2: 0.5 } }],
    ['mod amount not a number', { ...preset, mod: { 'env2:osc1.wave': '0.5' } }],
    [
      'more than 64 routes',
      { ...preset, mod: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`env2:fx.p${i}`, 0.1])) },
    ],
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

  it.each([
    ['lowcut', 19],
    ['pre', 0.31],
    ['size', -0.1],
    ['decay', 0.05],
    ['damp', 400],
    ['bass', 4.1],
    ['depth', 1.5],
    ['sep', 2.5],
    ['er', -1],
    ['era', 3],
    ['era', -1],
    ['era', 0.5],
  ])('rejects reverb %s out of range or not integer (%p)', (key, value) => {
    const data = { ...preset, fx: { ...preset.fx, reverb: { ...preset.fx.reverb, [key]: value } } };
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

  it('validates opened request', () => {
    expect(presetOpenedRequestSchema.parse({ editToken: 'x'.repeat(43), extra: 1 })).toEqual({
      editToken: 'x'.repeat(43),
    });
    expect(presetOpenedRequestSchema.safeParse({ editToken: 'short' }).success).toBe(false);
    expect(presetOpenedRequestSchema.safeParse({ editToken: 'x'.repeat(129) }).success).toBe(false);
    expect(presetOpenedRequestSchema.safeParse({}).success).toBe(false);
  });

  it('takes a listen or a stay of a preset with a captcha token', () => {
    const presetId = '5b6a2f2e-4f7c-4c2a-9a39-6f1f3f0b2a11';
    const turnstileToken = 'token';
    const listen = { presetId, event: 'listen', turnstileToken };
    const stay = { presetId, event: 'stay', turnstileToken };
    expect(usageRequestSchema.parse(listen)).toEqual(listen);
    expect(usageRequestSchema.parse(stay)).toEqual(stay);
    expect(usageRequestSchema.safeParse({ ...stay, presetId: 'x' }).success).toBe(false);
    expect(usageRequestSchema.safeParse({ ...stay, event: 'open' }).success).toBe(false);
    expect(usageRequestSchema.safeParse({ presetId, turnstileToken }).success).toBe(false);
    expect(usageRequestSchema.safeParse({}).success).toBe(false);
    // without a captcha (older clients)
    expect(usageRequestSchema.safeParse({ presetId, event: 'listen' }).success).toBe(false);
    expect(usageRequestSchema.safeParse({ ...listen, turnstileToken: '' }).success).toBe(false);
    expect(usageRequestSchema.safeParse({ ...listen, turnstileToken: 'x'.repeat(4097) }).success).toBe(false);
    // the batch of seconds of older clients
    expect(usageRequestSchema.safeParse({ clientId: 'c', items: [{ presetId, seconds: 60 }] }).success).toBe(
      false
    );
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

describe('fxSnapSchema', () => {
  const defaults = DELAY_DEFAULTS;

  it.each([undefined, null, 'x', [], {}])('falls back to the defaults for %p', (snap) => {
    expect(fxSnapSchema.parse(snap)).toEqual({
      o: ['distortion', 'delay', 'reverb'],
      distortion: DISTORTION_DEFAULTS,
      delay: defaults,
      reverb: REVERB_DEFAULTS,
    });
  });

  it('keeps valid values, falsy ones included', () => {
    const delay = { a: true, on: false, mix: 0, time: 0.5, fb: 0, mode: 1, pan: 0, freq: 50, q: 3 };
    const reverb = {
      ...REVERB_DEFAULTS,
      a: true,
      on: false,
      mix: 0,
      pre: 0,
      size: 0,
      depth: 0,
      sep: 0,
      era: 0,
    };
    const distortion = { a: true, on: false, mix: 0, mode: 0, drive: 0, tone: 500, level: 0 };
    expect(fxSnapSchema.parse({ o: ['reverb', 'delay', 'distortion'], distortion, delay, reverb })).toEqual({
      o: ['reverb', 'delay', 'distortion'],
      distortion,
      delay,
      reverb,
    });
  });

  it('replaces wrong types with defaults, clamps numbers and rounds int params', () => {
    const delay = { a: 'yes', on: 1, mix: Infinity, time: -1, fb: 1.5, mode: 0.6, pan: '0', q: 5, freq: NaN };
    const reverb = { decay: 100, damp: 'x', bass: 0, sep: -1, era: 1.6, tail: 1 };
    const distortion = { mode: 0.6, drive: 100, tone: 'x', level: -30 };
    expect(fxSnapSchema.parse({ o: 'delay', distortion, delay: { ...delay, extra: 1 }, reverb })).toEqual({
      o: ['distortion', 'delay', 'reverb'],
      distortion: { ...DISTORTION_DEFAULTS, mode: 1, drive: 12, level: -24 },
      delay: { ...defaults, time: 0.01, fb: 0.9, mode: 1, q: 3 },
      reverb: { ...REVERB_DEFAULTS, decay: 20, bass: 0.25, sep: 0, era: 2 },
    });
    expect(fxSnapSchema.parse({ reverb: { era: 7 } }).reverb.era).toBe(2);
    expect(fxSnapSchema.parse({ reverb: { era: -3 } }).reverb.era).toBe(0);
    expect(fxSnapSchema.parse({ distortion: { mode: 5 } }).distortion.mode).toBe(1);
  });

  it('accepts every value the preset schema accepts', () => {
    const fx = presetDataSchema.shape.fx.parse({
      delay: { a: true, mix: 1, time: 1, mode: 1, pan: -0.05 },
      reverb: { a: true, decay: 20, bass: 0.25, sep: 2, era: 0 },
      distortion: { a: true, mode: 1, drive: 12, tone: 500, level: -24 },
    });
    expect(fxSnapSchema.parse(fx)).toEqual(fx);
  });

  it('a non-object effect falls back to its defaults', () => {
    expect(fxSnapSchema.parse({ delay: 'on' }).delay).toEqual(defaults);
    expect(fxSnapSchema.parse({ reverb: 'on' }).reverb).toEqual(REVERB_DEFAULTS);
    expect(fxSnapSchema.parse({ distortion: 'on' }).distortion).toEqual(DISTORTION_DEFAULTS);
  });
});
