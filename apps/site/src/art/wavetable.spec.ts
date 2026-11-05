import {
  ART,
  ART_EXTENT,
  DIAGRAM,
  STACK,
  artFrames,
  diagramFrames,
  diagramTrack,
  frameAt,
  mix,
  ribbon,
  svgArea,
  svgPoints,
} from './wavetable';

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

  it('knows where its waves start and end across the box, whatever the time', () => {
    for (const time of [0, 3.3, 9]) {
      const xs = artFrames(time).flatMap((frame) => frame.xy.filter((_, i) => i % 2 === 0));
      expect(Math.min(...xs) / ART.width).toBeCloseTo(ART_EXTENT.from, 9);
      expect(Math.max(...xs) / ART.width).toBeCloseTo(ART_EXTENT.to, 9);
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

describe('the wavetable diagram', () => {
  it('stacks a few frames from a sine at the back to a saw at the front, inside its box', () => {
    const frames = diagramFrames();
    expect(frames).toHaveLength(DIAGRAM.frames);
    expect(frames[0].color).toBe('#3498db');
    expect(frames.at(-1)?.color).toBe('#2ecc71');
    // the back one up and right of the front one
    expect(frames[0].left).toBeGreaterThan(frames[frames.length - 1].left);
    expect(frames[0].zero).toBeLessThan(frames[frames.length - 1].zero);
    for (const frame of frames) {
      for (let i = 0; i < frame.xy.length; i += 2) {
        expect(frame.xy[i]).toBeGreaterThanOrEqual(0);
        expect(frame.xy[i]).toBeLessThanOrEqual(DIAGRAM.width);
        expect(frame.xy[i + 1]).toBeGreaterThanOrEqual(0);
        expect(frame.xy[i + 1]).toBeLessThanOrEqual(DIAGRAM.height);
      }
    }
  });

  it('lights the frame the Wave knob plays, the knob on its track left of it', () => {
    const frames = diagramFrames();
    expect(frames.filter((frame) => frame.glow > 0)).toEqual([frames[DIAGRAM.played]]);
    const { first, last, knob } = diagramTrack();
    expect(first).toEqual([frames[0].left - DIAGRAM.track, frames[0].zero]);
    expect(last).toEqual([frames[frames.length - 1].left - DIAGRAM.track, frames[frames.length - 1].zero]);
    expect(knob[1]).toBe(frames[DIAGRAM.played].zero);
    // on the line from the first frame to the last
    const along = (knob[0] - first[0]) / (last[0] - first[0]);
    expect(knob[1]).toBeCloseTo(first[1] + along * (last[1] - first[1]), 9);
    expect(first[0] - 20).toBeGreaterThan(0);
    expect(last[1] + 32).toBeLessThanOrEqual(DIAGRAM.height);
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
