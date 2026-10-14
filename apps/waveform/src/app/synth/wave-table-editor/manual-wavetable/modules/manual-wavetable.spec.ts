import { wave } from '@waveform/math';
import { createOscillator, initModel } from '../../../../../test-utils/models';
import { manualWavetable } from './manual-wavetable';

const setup = () => {
  const oscillator = createOscillator();
  oscillator[1].setWaveTable([new Array(16).fill(0), new Array(16).fill(0.5)]);
  const [model, actions] = initModel(manualWavetable({ oscillator }), 'manualWavetable', undefined);
  return { oscillator: oscillator[0], model, actions };
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
    oscillator.$current.next(1);
    actions.setRate(4); // one sample per segment

    actions.updateCurrentWave([15, -1]);

    expect(oscillator.$waveTable.value[1].value.at(-1)).toBe(-1);
    expect(oscillator.$waveTable.value[1].value.slice(0, 15)).toEqual(new Array(15).fill(0.5));
  });

  it('cloneCurrent appends a copy of the current wave', () => {
    const { oscillator, actions } = setup();
    oscillator.$current.next(1);

    actions.cloneCurrent();

    const table = oscillator.$waveTable.value;
    expect(table).toHaveLength(3);
    expect(table[2].value).toEqual(table[1].value);
    expect(table[2]).not.toBe(table[1]);
  });

  it('rebuilds the oscillator periodic wave after drawing', () => {
    const { oscillator, actions } = setup();
    actions.setRate(2);
    actions.updateCurrentWave([0, 1]);
    const { real, imag } = oscillator.$periodicWave.value as PeriodicWave & {
      real: number[];
      imag: number[];
    };
    expect([real, imag]).toEqual(wave.realWithImag([1, 1, 1, 1, ...new Array(12).fill(0)]));
  });
});
