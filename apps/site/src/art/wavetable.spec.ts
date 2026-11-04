import { ART, STACK, artFrames, frameAt, mix, ribbon, svgArea, svgPoints } from './wavetable';

describe('the wavetable drawing', () => {
  it('morphs a sine into a saw', () => {
    expect(frameAt(0, 0.25)).toBeCloseTo(1);
    expect(frameAt(0, 0.75)).toBeCloseTo(-1);
    // the last frame: the partial sums of a saw, Σ sin(2πhx)/h
    const saw = Array.from({ length: 14 }, (_, i) => Math.sin(2 * Math.PI * (i + 1) * 0.1) / (i + 1)).reduce(
      (a, b) => a + b
    );
    expect(frameAt(1, 0.1)).toBeCloseTo(saw);
  });

  it('stacks the frames back to front, from the blue of the logo to its green, inside its box', () => {
    const frames = artFrames(0);
    expect(frames).toHaveLength(STACK.frames);
    expect(frames[0].color).toBe('#3498db');
    expect(frames.at(-1)?.color).toBe('#2ecc71');
    for (const frame of frames) {
      expect(frame.xy).toHaveLength((STACK.samples + 1) * 2);
      for (let i = 0; i < frame.xy.length; i += 2) {
        expect(frame.xy[i]).toBeGreaterThanOrEqual(0);
        expect(frame.xy[i]).toBeLessThanOrEqual(ART.width);
        expect(frame.xy[i + 1]).toBeGreaterThanOrEqual(0);
        expect(frame.xy[i + 1]).toBeLessThanOrEqual(ART.height);
      }
    }
  });

  it('lights the played frame, between two frames both by their share', () => {
    for (const time of [0, 1.3, 4.7, 8]) {
      const glow = artFrames(time).reduce((sum, frame) => sum + frame.glow, 0);
      expect(glow).toBeCloseTo(1);
    }
  });

  it('moves with the time and comes back the same', () => {
    expect(artFrames(1.5)[5].xy).not.toEqual(artFrames(0)[5].xy);
    expect(artFrames(2)).toEqual(artFrames(2));
  });

  it('writes a frame for SVG', () => {
    const frame = {
      xy: [1.04, 2.06, 3, 4],
      zero: 5,
      left: 1,
      right: 3,
      color: '#000000',
      alpha: 1,
      width: 1,
      glow: 1,
    };
    expect(svgPoints(frame.xy)).toBe('1,2.1 3,4');
    expect(svgArea(frame)).toBe('1,2.1 3,4 3,5 1,5');
  });

  it('mixes colors', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('ribbon', () => {
  it('draws the voices of a unison, the middle one the brightest', () => {
    const lines = ribbon(1200, 200);
    expect(lines).toHaveLength(9);
    expect(lines[4].opacity).toBeCloseTo(0.95);
    expect(lines[0].opacity).toBeCloseTo(0.25);
    expect(lines[0].d.startsWith('M0 100')).toBe(true);
  });
});
