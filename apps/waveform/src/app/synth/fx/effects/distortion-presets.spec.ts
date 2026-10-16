import { FX_MIX_PARAMS, FX_PARAMS, normalizePreset } from '@waveform/preset-schema';
import { mapValues } from 'lodash';
import { DISTORTION_PRESETS } from './distortion-presets';
import { findFxPreset } from '.';

const PARAM_KEYS = Object.keys(FX_PARAMS.distortion).sort();

describe('distortion presets', () => {
  it('has 7 presets with unique ids and names, one of them is the default', () => {
    expect(DISTORTION_PRESETS).toHaveLength(7);
    expect(new Set(DISTORTION_PRESETS.map(({ id }) => id)).size).toBe(DISTORTION_PRESETS.length);
    expect(new Set(DISTORTION_PRESETS.map(({ name }) => name)).size).toBe(DISTORTION_PRESETS.length);
    expect(DISTORTION_PRESETS.some(({ id }) => id === 'default')).toBe(true);
  });

  it('the default preset is the schema defaults, the state of a freshly added distortion', () => {
    const preset = DISTORTION_PRESETS.find((item) => item.id === 'default');
    expect(preset?.mix).toBe(FX_MIX_PARAMS.distortion.default);
    expect(preset?.params).toEqual(mapValues(FX_PARAMS.distortion, (param) => param.default));
  });

  // a preset saved with the synth must load back unchanged, otherwise it would show up as Custom
  it.each(DISTORTION_PRESETS)(
    '$name sets every param and passes the synth preset schema unchanged',
    (preset) => {
      expect(Object.keys(preset.params).sort()).toEqual(PARAM_KEYS);
      const distortion = { a: true, on: true, mix: preset.mix, ...preset.params };
      expect(normalizePreset({ fx: { distortion } }).fx.distortion).toEqual(distortion);
    }
  );

  it('findFxPreset finds every preset by its mix and params', () => {
    DISTORTION_PRESETS.forEach((preset) => expect(findFxPreset('distortion', preset)).toBe(preset));
  });

  it('findFxPreset finds nothing when a param differs', () => {
    const [preset] = DISTORTION_PRESETS;
    expect(
      findFxPreset('distortion', { ...preset, params: { ...preset.params, drive: 12.5 } })
    ).toBeUndefined();
  });
});
