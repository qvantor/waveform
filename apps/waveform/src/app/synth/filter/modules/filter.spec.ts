import { applySnapshot, getSnapshot } from '../../../app';
import { createSynthCore, initModel } from '../../../../test-utils/models';
import { defaultFilterRanges } from '../constants';
import { filter } from './filter';

const setup = () => {
  const synthCore = createSynthCore();
  const addMidNode = jest.spyOn(synthCore[1] as Pick<typeof synthCore[1], 'addMidNode'>, 'addMidNode');
  const removeMidNode = jest.spyOn(
    synthCore[1] as Pick<typeof synthCore[1], 'removeMidNode'>,
    'removeMidNode'
  );
  const [model, actions] = initModel(filter({ synthCore }), 'filter', undefined);
  return { model, actions, synthCore: synthCore[0], addMidNode, removeMidNode };
};

describe('filter', () => {
  it('is bypassed by default', () => {
    const { model, synthCore, removeMidNode } = setup();
    expect(model.$active.value).toBe(false);
    expect(removeMidNode).toHaveBeenCalledWith(model.filterNode);
    expect(synthCore.$midNodes.value).toEqual([]);
  });

  it('toggleActive inserts and removes the filter node', () => {
    const { model, actions, synthCore, addMidNode } = setup();

    actions.toggleActive();
    expect(addMidNode).toHaveBeenCalledWith(model.filterNode);
    expect(synthCore.$midNodes.value).toEqual([model.filterNode]);

    actions.toggleActive();
    expect(synthCore.$midNodes.value).toEqual([]);
  });

  it('applies the values to the biquad node', () => {
    const { model, actions } = setup();
    actions.setNumericValue('cutoff', 1000);
    actions.setNumericValue('resonance', 5);

    expect(model.filterNode.frequency.setValueAtTime).toHaveBeenLastCalledWith(1000, 0);
    expect(model.filterNode.Q.setValueAtTime).toHaveBeenLastCalledWith(5, 0);
    expect(model.filterNode.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 0);
    expect(model.$filter.value).toEqual({ cutoff: 1000, resonance: 5, gain: 1 });
  });

  it('setType changes the node type and merges the type ranges', () => {
    const { model, actions } = setup();

    actions.setType('highshelf');

    expect(model.filterNode.type).toBe('highshelf');
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
