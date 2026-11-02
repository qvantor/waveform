import { FX_MIX_PARAMS, FX_PARAMS, normalizePreset, TEMPO_DIVISIONS } from '@waveform/preset-schema';
import { mapValues } from 'lodash';
import { DELAY_PRESETS } from './delay-presets';
import { delayDivisionOf } from './delay';
import { findFxPreset } from '.';

const PARAM_KEYS = Object.keys(FX_PARAMS.delay).sort();

describe('delay presets', () => {
  it('has 15 presets with unique ids and names, one of them is the default', () => {
    expect(DELAY_PRESETS).toHaveLength(15);
    expect(new Set(DELAY_PRESETS.map(({ id }) => id)).size).toBe(DELAY_PRESETS.length);
    expect(new Set(DELAY_PRESETS.map(({ name }) => name)).size).toBe(DELAY_PRESETS.length);
    expect(DELAY_PRESETS.some(({ id }) => id === 'default')).toBe(true);
  });

  // a division in a name is the time of the delay in BPM (a dotted one says so), the others play their time in
  // ms; no preset moves its time, so none promises it
  it('names a division only of a preset in BPM, and no time modulation', () => {
    DELAY_PRESETS.forEach(({ name, params }) => {
      expect(name).not.toMatch(/flutter|doubler/i);
      const division = /\d\/\d+/.exec(name)?.[0];
      expect(params.sync).toBe(division ? 1 : 0);
      if (!division) return;
      const { id, kind } = TEMPO_DIVISIONS[delayDivisionOf(params)];
      expect(id).toBe(kind === 'dotted' ? `${division}D` : division);
      expect(name.startsWith('Dotted')).toBe(kind === 'dotted');
    });
    expect(DELAY_PRESETS.filter(({ params }) => params.sync === 1).map(({ id }) => id)).toEqual([
      'dotted-eighth',
      'ping-pong-quarter',
    ]);
  });

  it('the default preset is the schema defaults, the state of a freshly added delay', () => {
    const preset = DELAY_PRESETS.find((item) => item.id === 'default');
    expect(preset?.mix).toBe(FX_MIX_PARAMS.delay.default);
    expect(preset?.params).toEqual(mapValues(FX_PARAMS.delay, (param) => param.default));
  });

  // a preset saved with the synth must load back unchanged, otherwise it would show up as Custom
  it.each(DELAY_PRESETS)('$name sets every param and passes the synth preset schema unchanged', (preset) => {
    expect(Object.keys(preset.params).sort()).toEqual(PARAM_KEYS);
    const delay = { a: true, on: true, mix: preset.mix, ...preset.params };
    expect(normalizePreset({ fx: { delay } }).fx.delay).toEqual(delay);
  });

  it('findFxPreset finds every preset by its mix and params', () => {
    DELAY_PRESETS.forEach((preset) => expect(findFxPreset('delay', preset)).toBe(preset));
  });

  it('findFxPreset finds nothing when the mix or a param differs', () => {
    const [preset] = DELAY_PRESETS;
    expect(findFxPreset('delay', { ...preset, mix: 0.31 })).toBeUndefined();
    expect(findFxPreset('delay', { ...preset, params: { ...preset.params, q: 0.02 } })).toBeUndefined();
    expect(findFxPreset('delay', { mix: preset.mix, params: { time: 0.2 } })).toBeUndefined();
  });
});
