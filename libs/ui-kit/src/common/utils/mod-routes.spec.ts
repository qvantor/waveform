import { routedShare, routeSpans } from './mod-routes';

// a travel of the routes over half of the travel of a control: their scale twice as long
const half = (share: number) => share / 2;

// spans equal to `expected` within float rounding
const expectSpans = (spans: [number, number][], expected: [number, number][]) => {
  expect(spans).toHaveLength(expected.length);
  spans.forEach(([from, to], i) => {
    expect(from).toBeCloseTo(expected[i][0], 12);
    expect(to).toBeCloseTo(expected[i][1], 12);
  });
};

describe('routeSpans', () => {
  it('without a travel spans from the position to the position + amount, clamped to the travel', () => {
    expectSpans(routeSpans(0.2, { amount: 0.4 }), [[0.2, 0.6]]);
    expect(routeSpans(0.8, { amount: 0.4 })).toEqual([[0.8, 1]]);
    expect(routeSpans(0.2, { amount: 0 })).toEqual([]);
  });

  it('with a travel maps its ends from the scale of the routes, then clamps them', () => {
    expectSpans(routeSpans(0.2, { amount: 0.4 }, false, half), [[0.1, 0.3]]);
    // bipolar: ±amount / 2 around the position, mapped
    expectSpans(routeSpans(0.4, { amount: 0.4, bipolar: true }, false, half), [[0.1, 0.3]]);
    // a position over the travel of the control (32 bars of 64 s on a scale of 32 s): clamped after the map
    expect(routeSpans(1.5, { amount: 1 }, false, half)).toEqual([[0.75, 1]]);
    expect(routeSpans(-0.4, { amount: -0.4 }, false, half)).toEqual([]);
    // wrap changes nothing with it
    expectSpans(routeSpans(0.2, { amount: 0.4 }, true, half), [[0.1, 0.3]]);
  });
});

describe('routedShare', () => {
  const level = () => 1;

  it('moves the share by the sum of the routes, clamped; null without a level', () => {
    expect(routedShare(0.2, [{ amount: 0.4, level }])).toBe(0.6);
    expect(routedShare(0.2, [{ amount: 0.4, level: () => null }])).toBeNull();
  });

  it('with a travel maps the share the routes move the position to', () => {
    expect(routedShare(0.2, [{ amount: 0.4, level }], false, half)).toBe(0.3);
    expect(routedShare(0.2, [{ amount: 0.4, level: () => 0.5, bipolar: true }], false, half)).toBe(0.1);
    expect(routedShare(1.5, [{ amount: 1, level }], false, half)).toBe(1);
  });
});
