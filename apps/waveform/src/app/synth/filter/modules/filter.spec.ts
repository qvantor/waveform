import { applySnapshot, getSnapshot } from '../../../app';
import { createSynthCore, initModel } from '../../../../test-utils/models';
import { defaultFilterRanges } from '../constants';
import { filter } from './filter';

const setup = () => {
  const synthCore = createSynthCore();
  const [model, actions] = initModel(filter({ synthCore }), 'filter', undefined);
  // the values the voices get
  const played: unknown[] = [];
  model.$voiceFilter.subscribe((value) => played.push(value));
  return { model, actions, played };
};

describe('filter', () => {
  it('is off by default: the voices play no filter', () => {
    const { model, played } = setup();
    expect(model.$active.value).toBe(false);
    expect(model.voiceFilter()).toBeNull();
    expect(played).toEqual([null]);
  });

  it('gives the voices its knobs while it is on, once per change', () => {
    const { model, actions, played } = setup();
    actions.toggleActive();
    actions.setNumericValue('cutoff', 1000);
    actions.setNumericValue('cutoff', 1000);
    actions.setNumericValue('resonance', 5);
    const on = { type: 'lowpass', cutoff: 1000, resonance: 5, gain: 1 };
    expect(model.voiceFilter()).toEqual(on);
    actions.toggleActive();
    expect(played).toEqual([
      null,
      { type: 'lowpass', cutoff: 440, resonance: 0, gain: 1 },
      { ...on, resonance: 0 },
      on,
      null,
    ]);
  });

  it('has no node of its own: it is in the voices', () => {
    const { model } = setup();
    expect(model).not.toHaveProperty('filterNode');
    expect(model.sampleRate).toBe(44100);
  });

  it('setType changes the type of the voices and merges the type ranges', () => {
    const { model, actions } = setup();

    actions.setType('highshelf');

    expect(model.$filterType.value).toBe('highshelf');
    expect(model.$ranges.value.gain).toEqual({ ...defaultFilterRanges.gain, min: -40, max: 40 });
    expect(model.$ranges.value.resonance.disabled).toBe(true);
    expect(model.$ranges.value.cutoff).toEqual(defaultFilterRanges.cutoff);
    // the defaults are not mutated by the merge
    expect(defaultFilterRanges.gain).toEqual({ min: 0, max: 1, precision: 100 });
  });

  it('clamps the values to the ranges of the new type', () => {
    const { model, actions } = setup();
    actions.setNumericValue('resonance', 0);

    actions.setType('bandpass');
    expect(model.$filter.value.resonance).toBe(0.01);

    actions.setNumericValue('resonance', 15);
    actions.setType('peaking');
    expect(model.$filter.value.resonance).toBe(10);
  });

  it('setFilterValues replaces all values', () => {
    const { model, actions } = setup();
    actions.setFilterValues({ cutoff: 200, resonance: 1, gain: 0.5 });
    expect(model.$filter.value).toEqual({ cutoff: 200, resonance: 1, gain: 0.5 });
  });

  describe('snapshot', () => {
    it('exposes the persisted state', () => {
      const { actions } = setup();
      actions.toggleActive();
      actions.setType('highpass');
      actions.setNumericValue('cutoff', 1200);
      expect(getSnapshot()['filter']).toEqual({ a: true, t: 'highpass', cut: 1200, gain: 1, res: 0 });
    });

    it('applies values before the type so they are clamped by the type ranges', () => {
      const { model } = setup();
      applySnapshot({ filter: { a: true, t: 'bandpass', cut: 800, res: 0, gain: 0 } });

      expect(model.$active.value).toBe(true);
      expect(model.$filterType.value).toBe('bandpass');
      expect(model.$filter.value).toEqual({ cutoff: 800, resonance: 0.01, gain: 0 });
    });

    it('applies falsy values and restores defaults for missing keys', () => {
      const { model, actions } = setup();
      actions.toggleActive();
      actions.setType('highpass');
      actions.setNumericValue('cutoff', 5000);

      applySnapshot({ filter: { a: false } });

      expect(model.$active.value).toBe(false);
      expect(model.$filter.value).toEqual({ cutoff: 440, resonance: 0, gain: 1 });
      // the type is kept when it is not in the snapshot
      expect(model.$filterType.value).toBe('highpass');
    });
  });
});
