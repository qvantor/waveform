import { FX_MIX_PARAM, FX_PARAMS, normalizePreset } from '@waveform/preset-schema';
import { mapValues } from 'lodash';
import { REVERB_PRESETS } from './reverb-presets';
import { findFxPreset } from '.';

const PARAM_KEYS = Object.keys(FX_PARAMS.reverb).sort();

describe('reverb presets', () => {
  it('has 12 presets with unique ids and names, one of them is the default', () => {
    expect(REVERB_PRESETS).toHaveLength(12);
    expect(new Set(REVERB_PRESETS.map(({ id }) => id)).size).toBe(REVERB_PRESETS.length);
    expect(new Set(REVERB_PRESETS.map(({ name }) => name)).size).toBe(REVERB_PRESETS.length);
    expect(REVERB_PRESETS.some(({ id }) => id === 'default')).toBe(true);
  });

  it('the default preset is the schema defaults, the state of a freshly added reverb', () => {
    const preset = REVERB_PRESETS.find((item) => item.id === 'default');
    expect(preset?.mix).toBe(FX_MIX_PARAM.default);
    expect(preset?.params).toEqual(mapValues(FX_PARAMS.reverb, (param) => param.default));
  });

  // a preset saved with the synth must load back unchanged, otherwise it would show up as Custom
  it.each(REVERB_PRESETS)('$name sets every param and passes the synth preset schema unchanged', (preset) => {
    expect(Object.keys(preset.params).sort()).toEqual(PARAM_KEYS);
    const reverb = { a: true, on: true, mix: preset.mix, ...preset.params };
    expect(normalizePreset({ fx: { reverb } }).fx.reverb).toEqual(reverb);
  });

  it('findFxPreset finds every preset by its mix and params', () => {
    REVERB_PRESETS.forEach((preset) => expect(findFxPreset('reverb', preset)).toBe(preset));
  });

  it('findFxPreset finds nothing when a param differs', () => {
    const [preset] = REVERB_PRESETS;
    expect(findFxPreset('reverb', { ...preset, params: { ...preset.params, decay: 2.1 } })).toBeUndefined();
  });
});
