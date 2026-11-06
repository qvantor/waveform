import { FxRoute, movedBy, routeTerm } from '../../fx/effects/fx-modulation';
import type { ModRoute } from '../modules/modulation';
import { ROUTE_IDS } from '../wavetable/voice-modules';
import { lfoKnobRoutes, MOD_TARGETS, routeAmount } from './modulation-targets';

// the knob a route moves from `base` at the level 1 of its source (unclamped: the bounds clamp it after)
const movedAtOne = (base: number, route: FxRoute) => movedBy(base, routeTerm(route, 1), route);

const routeOf = (route: ModRoute, bounds?: [number, number]) =>
  lfoKnobRoutes([route], bounds ? { [route.target]: bounds } : {})[0];

describe('routeAmount', () => {
  // Rise of an LFO: pow over 32 s in HZ; in BPM within 32 bars at the tempo: 64 s at 120, 384 s at 20
  const rise: ModRoute = { source: 'env2', target: 'lfo1.rise', amount: 0.25 };

  it('moves a pow knob within another bound as over its range: the travel of HZ whatever the tempo', () => {
    const hz = movedAtOne(1, routeOf(rise));
    // 32 · ((1/32)^¼ + 0.25)⁴
    expect(hz).toBeCloseTo(6.466, 3);
    expect(movedAtOne(1, routeOf(rise, [0, 64]))).toBeCloseTo(hz, 12);
    expect(movedAtOne(1, routeOf(rise, [0, 384]))).toBeCloseTo(hz, 12);
    // a bipolar one too, down as up
    const down: ModRoute = { ...rise, amount: -0.5, bipolar: true };
    expect(movedAtOne(4, routeOf(down, [0, 64]))).toBeCloseTo(movedAtOne(4, routeOf(down)), 12);
  });

  it('clamps it to the bound: 32 bars at 300 BPM are 25.6 s, under the travel of HZ', () => {
    const up: ModRoute = { ...rise, amount: 0.5 };
    expect(movedAtOne(20, routeOf(up))).toBe(32);
    expect(movedAtOne(20, routeOf(up, [0, 25.6]))).toBe(25.6);
    // below it as over the range
    expect(movedAtOne(1, routeOf(rise, [0, 25.6]))).toBeCloseTo(movedAtOne(1, routeOf(rise)), 12);
  });

  it('keeps the amount of a pow route over its range, of a linear and a log one whatever the bounds', () => {
    expect(routeAmount(0.25, 'pow', [0, 32])).toBe(0.25);
    expect(routeAmount(0.25, 'pow', [0, 32], [0, 32])).toBe(0.25);
    expect(routeAmount(0.5, 'linear', [0, 2], [0, 1])).toBe(1);
    expect(routeAmount(0.5, 'log', [1 / 32, 100], [1 / 64, 100])).toBe(0.5 * Math.log2(3200));
  });
});

describe('the knobs of the voice', () => {
  it('are every knob of the modules of the voice, each the route of one target (the fx follow the last note)', () => {
    const routes = Object.values(MOD_TARGETS).flatMap((target) =>
      target.kind === 'fx' ? [] : [target.route]
    );
    expect([...routes].sort()).toEqual(Object.keys(ROUTE_IDS).sort());
    expect(MOD_TARGETS['osc2.wave']).toMatchObject({ route: 'position2' });
    expect(MOD_TARGETS['osc1.detune']).toMatchObject({ route: 'spread1' });
    expect(MOD_TARGETS['filter.gain']).toMatchObject({ route: 'gain' });
    expect(MOD_TARGETS['noise.pitch']).toMatchObject({ route: 'noise.pitch' });
    expect(MOD_TARGETS['lfo3.smooth']).toMatchObject({ route: 'lfo3.smooth' });
  });
});
