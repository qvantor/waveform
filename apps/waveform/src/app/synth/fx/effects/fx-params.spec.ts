import { createFxParams } from './fx-params';

describe('createFxParams', () => {
  it('smooths the changes again after an instant set that threw', () => {
    const audioCtx = new AudioContext();
    const { gain } = audioCtx.createGain();
    const { setValue, bind, instantly } = createFxParams(audioCtx, { level: { min: 0, max: 1, default: 1 } });
    const setParam = bind({ level: (value) => setValue(gain, value) });
    expect(() =>
      instantly(() => {
        throw new TypeError('not finite');
      })
    ).toThrow(TypeError);
    setParam('level', 0.5);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 0, expect.any(Number));
  });
});
