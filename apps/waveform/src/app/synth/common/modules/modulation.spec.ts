import { MOD_SOURCES } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createModulation } from '../../../../test-utils/models';
import { MOD_TARGETS } from '../modulation/modulation-targets';
import { takesSource } from './modulation';

// every route there can be: every source on every knob it takes (no LFO on a knob of an LFO)
const ALL = MOD_SOURCES.flatMap((source) =>
  Object.keys(MOD_TARGETS)
    .filter((target) => takesSource(source, target))
    .map((target) => [source, target] as const)
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
    (['lfo1', 'lfo2', 'lfo3', 'lfo4'] as const).forEach((source) => addRoute(source, 'osc1.gain'));
    addRoute('env1', 'osc1.gain');
    addRoute('env1', 'osc1.wave');
    expect($routes.value.map(({ source, target }) => `${source}:${target}`)).toEqual([
      'lfo1:osc1.gain',
      'lfo2:osc1.gain',
      'lfo3:osc1.gain',
      'lfo4:osc1.gain',
      'env1:osc1.wave',
    ]);
  });

  it('puts the envelopes and the velocity on the knobs of the LFOs, no LFO', () => {
    const [{ $routes }, { addRoute }] = createModulation();
    addRoute('env2', 'lfo1.rate');
    addRoute('velo', 'lfo3.phase');
    addRoute('lfo2', 'lfo1.rate');
    addRoute('lfo1', 'lfo1.delay');
    expect($routes.value).toEqual([
      { source: 'env2', target: 'lfo1.rate', amount: 0.5 },
      { source: 'velo', target: 'lfo3.phase', amount: 0.5 },
    ]);
  });

  it('drops a route bipolar on a knob centered on 0 (the gain of the filter, the pan of the delay), uni elsewhere', () => {
    const [{ $routes }, { addRoute }] = createModulation();
    addRoute('lfo1', 'filter.gain');
    addRoute('lfo1', 'delay.pan');
    addRoute('lfo1', 'filter.cutoff');
    addRoute('env2', 'distortion.level');
    addRoute('lfo2', 'osc1.wave', 0.5, true);
    expect($routes.value).toEqual([
      { source: 'lfo1', target: 'filter.gain', amount: 0.5, bipolar: true },
      { source: 'lfo1', target: 'delay.pan', amount: 0.5, bipolar: true },
      { source: 'lfo1', target: 'filter.cutoff', amount: 0.5 },
      { source: 'env2', target: 'distortion.level', amount: 0.5 },
      { source: 'lfo2', target: 'osc1.wave', amount: 0.5, bipolar: true },
    ]);
  });

  it('switches a route between uni and bipolar, keeps its amount', () => {
    const [{ $routes }, { addRoute, setPolarity, setAmount }] = createModulation();
    addRoute('lfo1', 'osc1.wave');
    setAmount('lfo1', 'osc1.wave', -0.3);
    setPolarity('lfo1', 'osc1.wave', true);
    expect($routes.value).toEqual([{ source: 'lfo1', target: 'osc1.wave', amount: -0.3, bipolar: true }]);
    setPolarity('lfo1', 'osc1.wave', false);
    expect($routes.value).toEqual([{ source: 'lfo1', target: 'osc1.wave', amount: -0.3 }]);
    setPolarity('lfo2', 'osc1.wave', true);
    expect($routes.value).toHaveLength(1);
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

  it('round trips through the snapshot, an amount of 0 and a bipolar route too', () => {
    const [{ $routes }, { addRoute, setAmount }] = createModulation();
    addRoute('env2', 'osc1.wave');
    addRoute('env3', 'osc2.detune');
    setAmount('env3', 'osc2.detune', 0);
    addRoute('lfo4', 'filter.gain');
    const snapshot = getSnapshot();
    expect(snapshot['mod']).toEqual({
      'env2:osc1.wave': 0.5,
      'env3:osc2.detune': 0,
      'lfo4:filter.gain': { a: 0.5, bi: true },
    });
    const routes = $routes.value;
    applySnapshot({});
    expect($routes.value).toEqual([]);
    applySnapshot(snapshot);
    expect($routes.value).toEqual(routes);
  });

  it('a missing key is no route, unknown sources and knobs, an LFO on an LFO and odd values are left out', () => {
    const [{ $routes }, { addRoute }] = createModulation();
    addRoute('env1', 'osc1.gain');
    applySnapshot({
      mod: {
        'env2:osc1.detune': -1,
        'lfo1:osc1.wave': 0.5,
        'lfo2:filter.cutoff': { a: 2, bi: true },
        'lfo3:osc1.gain': { a: 0.25, bi: false },
        'lfo1:lfo2.rate': 0.5,
        'lfo5:osc1.wave': 0.5,
        'env3:osc9.wave': 0.5,
        'env3:osc1.gain': { bi: true },
        env1: 1,
      },
    });
    expect($routes.value).toEqual([
      { source: 'env2', target: 'osc1.detune', amount: -1 },
      { source: 'lfo1', target: 'osc1.wave', amount: 0.5 },
      { source: 'lfo2', target: 'filter.cutoff', amount: 1, bipolar: true },
      { source: 'lfo3', target: 'osc1.gain', amount: 0.25 },
    ]);
  });

  it('keeps the first 64 routes of a snapshot', () => {
    const [{ $routes }] = createModulation();
    applySnapshot({ mod: Object.fromEntries(ALL.map(([source, target]) => [`${source}:${target}`, 0.5])) });
    expect($routes.value).toHaveLength(64);
    expect($routes.value.at(-1)).toMatchObject({ source: ALL[63][0], target: ALL[63][1] });
  });
});
