import { createOscillator, initModel } from '../../../../../test-utils/models';
import { audiofile } from './audiofile';

// sample values equal their index, so the picked waves are easy to check
const ramp = (length: number) => Float32Array.from({ length }, (_, i) => i);

const setup = (audioBuffer = ramp(1024)) => {
  const oscillator = createOscillator();
  const [model, actions] = initModel(audiofile({ oscillator }), 'audiofile', { audioBuffer });
  return { oscillator, model, actions };
};

describe('audiofile', () => {
  it('spreads the wave pickers over the whole buffer', () => {
    const { model, actions } = setup();
    expect(model.$wavePickers.value).toHaveLength(32);

    actions.setWavesPickersCount(4);

    expect(model.$wavePickers.value).toEqual([0, 256, 512, 768]);
  });

  it('shifts the pickers by the phase in percents of a step', () => {
    const { model, actions } = setup();
    actions.setWavesPickersCount(4);
    actions.setPhase(50);
    expect(model.$wavePickers.value).toEqual([128, 384, 640, 896]);
  });

  it('writes a wave of 2^waveSize samples from every picker to the oscillator', () => {
    const { oscillator, actions } = setup();
    actions.setWavesPickersCount(4);
    actions.setWaveSize(2);

    const table = oscillator[0].$waveTable.value.map(($wave) => $wave.value);
    expect(table).toEqual([
      [0, 1, 2, 3],
      [256, 257, 258, 259],
      [512, 513, 514, 515],
      [768, 769, 770, 771],
    ]);
  });

  it('skips pickers whose wave does not fit into the buffer', () => {
    const { oscillator, actions } = setup();
    actions.setWavesPickersCount(4);
    actions.setWaveSize(9); // 512 samples

    expect(oscillator[0].$waveTable.value.map(($wave) => $wave.value[0])).toEqual([0, 256, 512]);
  });

  it('setWavesPickers places pickers manually', () => {
    const { oscillator, actions } = setup();
    actions.setWaveSize(1);
    actions.setWavesPickers([10, 20]);
    expect(oscillator[0].$waveTable.value.map(($wave) => $wave.value)).toEqual([
      [10, 11],
      [20, 21],
    ]);
  });

  it('moves the position of the oscillator into the new table', () => {
    const { oscillator, actions } = setup();
    actions.setWavesPickersCount(8);
    actions.setWaveSize(2);
    oscillator[1].setPosition(7);

    actions.setWavesPickersCount(2);

    expect(oscillator[0].$position.value).toBe(1);
  });
});
