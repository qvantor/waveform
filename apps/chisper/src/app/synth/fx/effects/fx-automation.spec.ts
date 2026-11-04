import { glideParam, setParam } from './fx-automation';

describe('fx-automation', () => {
  it('steps a param at its time, glides it from there by its time constant', () => {
    const param = { setValueAtTime: jest.fn(), setTargetAtTime: jest.fn() } as unknown as AudioParam;
    setParam(param, 0.5, 1);
    glideParam(param, 0.8, 2, 0.01);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.5, 1);
    expect(param.setTargetAtTime).toHaveBeenCalledWith(0.8, 2, 0.01);
  });
});
