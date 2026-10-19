import { applySnapshot, getSnapshot } from '../../../app';
import { createModulation } from '../../../../test-utils/models';

describe('modulation', () => {
  it('has no routes by default', () => {
    const [{ $routes }] = createModulation();
    expect($routes.value).toEqual([]);
    expect(getSnapshot()['mod']).toEqual({});
  });

  it('adds a route at +50% by default, a source already on the knob keeps its amount', () => {
    const [{ $routes }, { addRoute, setAmount }] = createModulation();
    addRoute('env2', 'osc1.wave');
    expect($routes.value).toEqual([{ source: 'env2', target: 'osc1.wave', amount: 0.5 }]);
    setAmount('env2', 'osc1.wave', -0.3);
    addRoute('env2', 'osc1.wave');
    addRoute('env3', 'osc1.wave', 1);
    expect($routes.value).toEqual([
      { source: 'env2', target: 'osc1.wave', amount: -0.3 },
      { source: 'env3', target: 'osc1.wave', amount: 1 },
    ]);
  });

  it('adds no route to a knob it does not know', () => {
    const [{ $routes }, { addRoute }] = createModulation();
    addRoute('env1', 'osc1.unison');
    expect($routes.value).toEqual([]);
  });

  it('sets the amount of a route within -100%..+100%, nothing for a missing route', () => {
    const [{ $routes }, { addRoute, setAmount }] = createModulation();
    addRoute('env1', 'osc2.gain');
    setAmount('env1', 'osc2.gain', 1.5);
    expect($routes.value[0].amount).toBe(1);
    setAmount('env1', 'osc2.gain', -2);
    expect($routes.value[0].amount).toBe(-1);
    setAmount('env2', 'osc2.gain', 0.1);
    expect($routes.value).toHaveLength(1);
  });

  it('removes a route', () => {
    const [{ $routes }, { addRoute, removeRoute }] = createModulation();
    addRoute('env1', 'osc2.gain');
    addRoute('env2', 'osc2.gain');
    removeRoute('env1', 'osc2.gain');
    expect($routes.value).toEqual([{ source: 'env2', target: 'osc2.gain', amount: 0.5 }]);
  });

  it('round trips through the snapshot, an amount of 0 too', () => {
    const [{ $routes }, { addRoute, setAmount }] = createModulation();
    addRoute('env2', 'osc1.wave');
    addRoute('env3', 'osc2.detune');
    setAmount('env3', 'osc2.detune', 0);
    const snapshot = getSnapshot();
    expect(snapshot['mod']).toEqual({ 'env2:osc1.wave': 0.5, 'env3:osc2.detune': 0 });
    const routes = $routes.value;
    applySnapshot({});
    expect($routes.value).toEqual([]);
    applySnapshot(snapshot);
    expect($routes.value).toEqual(routes);
  });

  it('a missing key is no route, unknown sources and knobs are left out', () => {
    const [{ $routes }, { addRoute }] = createModulation();
    addRoute('env1', 'osc1.gain');
    applySnapshot({ mod: { 'env2:osc1.detune': -1, 'lfo1:osc1.wave': 0.5, 'env3:osc9.wave': 0.5, env1: 1 } });
    expect($routes.value).toEqual([{ source: 'env2', target: 'osc1.detune', amount: -1 }]);
  });
});
