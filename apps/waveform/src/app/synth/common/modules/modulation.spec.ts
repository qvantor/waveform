import { MOD_SOURCES, ModSource } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createModulation } from '../../../../test-utils/models';
import { MOD_TARGETS } from '../modulation/modulation-targets';

// every route there can be: every envelope on every knob (87)
const ALL = MOD_SOURCES.flatMap((source) =>
  Object.keys(MOD_TARGETS).map((target) => [source, target] as const)
);

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

  it('adds no route past 64, the routes there still change and a removed one makes room', () => {
    const [{ $routes }, { addRoute, setAmount, removeRoute }] = createModulation();
    ALL.slice(0, 65).forEach(([source, target]) => addRoute(source, target));
    expect($routes.value).toHaveLength(64);
    expect($routes.value.at(-1)).toMatchObject({ source: ALL[63][0], target: ALL[63][1] });
    const [source, target] = ALL[0];
    setAmount(source, target, 0.2);
    expect($routes.value[0].amount).toBe(0.2);
    removeRoute(source, target);
    addRoute(...ALL[64]);
    expect($routes.value).toHaveLength(64);
    expect($routes.value.at(-1)).toMatchObject({ source: ALL[64][0], target: ALL[64][1] });
  });

  it('puts at most 4 sources on a knob', () => {
    const [{ $routes }, { addRoute }] = createModulation();
    // 4 sources there are not yet (the LFOs to come)
    const lfos = ['lfo1', 'lfo2', 'lfo3', 'lfo4'].map((source) => ({
      source: source as ModSource,
      target: 'osc1.gain',
      amount: 0.5,
    }));
    $routes.next(lfos);
    addRoute('env1', 'osc1.gain');
    addRoute('env1', 'osc1.wave');
    expect($routes.value).toEqual([...lfos, { source: 'env1', target: 'osc1.wave', amount: 0.5 }]);
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

  it('keeps the first 64 routes of a snapshot', () => {
    const [{ $routes }] = createModulation();
    applySnapshot({ mod: Object.fromEntries(ALL.map(([source, target]) => [`${source}:${target}`, 0.5])) });
    expect($routes.value).toHaveLength(64);
    expect($routes.value.at(-1)).toMatchObject({ source: ALL[63][0], target: ALL[63][1] });
  });
});
