import { BehaviorSubject } from 'rxjs';
import { createOscillator, createSynthCore, initModel } from '../../../../../test-utils/models';
import { manualWavetable } from './manual-wavetable';

const setup = () => {
  const synthCore = createSynthCore();
  const setTable = jest.spyOn(synthCore[0].wavetables, 'setTable');
  const oscillator = createOscillator(synthCore);
  oscillator[1].setWaveTable([new Array(16).fill(0), new Array(16).fill(0.5)]);
  const [model, actions] = initModel(manualWavetable({ oscillator }), 'manualWavetable', undefined);
  return { oscillator: oscillator[0], model, actions, setTable };
};

describe('manualWavetable', () => {
  it('draws a segment of the current wave, the segment size depends on the rate', () => {
    const { oscillator, actions } = setup();
    actions.setRate(2); // 4 segments of 4 samples

    actions.updateCurrentWave([1, 1]);

    expect(oscillator.$waveTable.value[0].value).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(oscillator.$waveTable.value[1].value).toEqual(new Array(16).fill(0.5));
  });

  it('draws on the selected wave', () => {
    const { oscillator, actions } = setup();
    oscillator.$position.next(1);
    actions.setRate(4); // one sample per segment

    actions.updateCurrentWave([15, -1]);

    expect(oscillator.$waveTable.value[1].value.at(-1)).toBe(-1);
    expect(oscillator.$waveTable.value[1].value.slice(0, 15)).toEqual(new Array(15).fill(0.5));
  });

  it('cloneCurrent appends a copy of the current wave', () => {
    const { oscillator, actions } = setup();
    oscillator.$position.next(1);

    actions.cloneCurrent();

    const table = oscillator.$waveTable.value;
    expect(table).toHaveLength(3);
    expect(table[2].value).toEqual(table[1].value);
    expect(table[2]).not.toBe(table[1]);
  });

  it('adds no wave to a table of 256', () => {
    const { oscillator, actions } = setup();
    const frames = Array.from({ length: 256 }, () => new Array(16).fill(0));
    oscillator.$waveTable.next(frames.map((frame) => new BehaviorSubject(frame)));
    actions.cloneCurrent();
    expect(oscillator.$waveTable.value).toHaveLength(256);
  });

  it('works on the frame nearest to the position', () => {
    const { oscillator, actions } = setup();
    oscillator.$position.next(0.6);
    actions.setRate(4);
    actions.updateCurrentWave([0, 1]);
    expect(oscillator.$waveTable.value[1].value[0]).toBe(1);
    expect(oscillator.$waveTable.value[0].value[0]).toBe(0);
  });

  it('sends the drawn table to the wavetable oscillator (at most every 100 ms)', () => {
    jest.useFakeTimers();
    const { oscillator, actions, setTable } = setup();
    actions.setRate(2);
    actions.updateCurrentWave([0, 1]);
    jest.advanceTimersByTime(100);
    expect(setTable).toHaveBeenLastCalledWith(
      oscillator.id,
      [[1, 1, 1, 1, ...new Array(12).fill(0)], new Array(16).fill(0.5)],
      false
    );
    jest.useRealTimers();
  });
});
