// The drawings of the page: a wavetable as a stack of its frames (a sine that grows into a saw, the back frames
// blue, the front green, as the logo), still in the SVG of the page and moving on a canvas over it (art.ts), the
// same table as a diagram of a few frames and the Wave knob, and a ribbon of detuned sines (a unison). Pure math:
// the build and the browser run the same.

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 10) / 10;

// a color between two #rrggbb
export const mix = (from: string, to: string, t: number) => {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const value = [0, 1, 2].map((i) => Math.round(lerp(channel(from, i), channel(to, i), t)));
  return `#${value.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const TAU = 2 * Math.PI;

// a saw of its first harmonics, each weighted: Σ gain(h)·sin(2πhx)/h
export const partials = (x: number, harmonics: number, gain: (h: number) => number = () => 1) => {
  let y = 0;
  for (let h = 1; h <= harmonics; h++) y += (gain(h) * Math.sin(TAU * h * x)) / h;
  return y;
};

// a sine of a period in seconds, a lag of its phase
export const wave = (time: number, period: number, lag = 0) => Math.sin((TAU * time) / period - lag);

const HARMONICS = 14;

// frame t (0..1) of the table at x (periodic over 0..1): the fundamental, the harmonics coming in one after another
// as t grows (each over its own share of t), so the first frame is a sine and the last a saw; those not in yet
// (gain 0, h ≥ t·HARMONICS + 2) aren't summed
export const frameAt = (t: number, x: number) =>
  partials(x, Math.min(HARMONICS, Math.ceil(t * HARMONICS) + 1), (h) =>
    h === 1 ? 1 : clamp(t * HARMONICS - (h - 2))
  );

// the box of the drawing (its viewBox) and the stack in it: each frame back from the front one is moved up and
// right by `depth`
export const ART = { width: 600, height: 400 };
export const STACK = {
  frames: 22,
  samples: 72,
  width: 400,
  amplitude: 80,
  depth: [6.8, 8.4] as const,
  origin: [36, 300] as const,
};

// where the waves of the stack start and end across the box, as shares of its width: the left end of the front
// frame, the right end of the back one (the motion moves the waves, not their ends)
export const ART_EXTENT = {
  from: STACK.origin[0] / ART.width,
  to: (STACK.origin[0] + (STACK.frames - 1) * STACK.depth[0] + STACK.width) / ART.width,
};

// the motion, in seconds: the frames slide sideways in a wave that runs back through the stack (a lag per frame),
// their shapes breathe between the sine and the saw, the frame the Wave knob plays sweeps over the stack
const MOTION = {
  slide: { amount: 0.07, period: 9, lag: 0.24 },
  breath: { amount: 0.12, period: 14, lag: 0.15 },
  sweep: { span: 0.4, period: 11 },
};

// the area of the played frame down to its zero line: the green of the logo (its channels) fading out, its opacity
// at the top and at the zero line, as the synth fills its wave
export const ART_FILL = { rgb: '46, 204, 113', top: 0.38, bottom: 0.03 };

// a frame at a time: its points (x, y in turn), its zero line and ends (the area of a played frame), its color,
// how opaque and thick its line is and how much it is the played frame (`glow` 0..1: the sweep between two frames
// lights both)
export type ArtFrame = {
  xy: number[];
  zero: number;
  left: number;
  right: number;
  color: string;
  alpha: number;
  width: number;
  glow: number;
};

// what a frame of the stack keeps whatever the time: its share from the back, its place, its color
const LAYERS = Array.from({ length: STACK.frames }, (_, k) => {
  const share = k / (STACK.frames - 1);
  const back = STACK.frames - 1 - k;
  const left = STACK.origin[0] + back * STACK.depth[0];
  return {
    share,
    left,
    zero: STACK.origin[1] - back * STACK.depth[1],
    color: mix('#3498db', '#2ecc71', share),
    base: lerp(0.28, 0.8, share),
  };
});

export const artFrames = (time = 0): ArtFrame[] => {
  const { frames, samples, width, amplitude } = STACK;
  const { slide, breath, sweep } = MOTION;
  const played = (0.5 + sweep.span * wave(time, sweep.period)) * (frames - 1);
  return LAYERS.map(({ share, left, zero, color, base }, k) => {
    const t = clamp(share + breath.amount * wave(time, breath.period, breath.lag * k));
    const shift = slide.amount * wave(time, slide.period, slide.lag * k);
    const xy = new Array<number>(2 * (samples + 1));
    let peak = 0;
    for (let i = 0; i <= samples; i++) {
      const value = frameAt(t, i / samples + shift);
      xy[2 * i + 1] = value;
      peak = Math.max(peak, Math.abs(value));
    }
    peak ||= 1;
    for (let i = 0; i <= samples; i++) {
      xy[2 * i] = left + (i / samples) * width;
      xy[2 * i + 1] = zero - (xy[2 * i + 1] / peak) * amplitude;
    }
    const glow = Math.max(0, 1 - Math.abs(k - played));
    return {
      xy,
      zero,
      left,
      right: left + width,
      color,
      alpha: lerp(base, 1, glow),
      width: 1.1 + 1.4 * glow,
      glow,
    };
  });
};

// the drawing beside "What is a wavetable synth?": a table of a few frames stacked as the art's (a sine at the
// back, a saw at the front; each frame back from the front moved up and right by `depth`), the frame the Wave knob
// plays lit, and the track of the knob `track` left of the frames' left ends, from frame 1 at the back to the last
// at the front
export const DIAGRAM = {
  width: 560,
  height: 420,
  frames: 8,
  samples: 96,
  frameWidth: 280,
  amplitude: 40,
  depth: [26, 34] as const,
  origin: [80, 330] as const,
  played: 5,
  track: 46,
};

const diagramPlace = (k: number) => {
  const back = DIAGRAM.frames - 1 - k;
  return {
    left: DIAGRAM.origin[0] + back * DIAGRAM.depth[0],
    zero: DIAGRAM.origin[1] - back * DIAGRAM.depth[1],
  };
};

export const diagramFrames = (): ArtFrame[] => {
  const { frames, samples, frameWidth, amplitude, played } = DIAGRAM;
  return Array.from({ length: frames }, (_, k) => {
    const share = k / (frames - 1);
    const { left, zero } = diagramPlace(k);
    const values = Array.from({ length: samples + 1 }, (__, i) => frameAt(share, i / samples));
    const peak = Math.max(...values.map(Math.abs)) || 1;
    const xy = values.flatMap((value, i) => [
      left + (i / samples) * frameWidth,
      zero - (value / peak) * amplitude,
    ]);
    const lit = k === played;
    return {
      xy,
      zero,
      left,
      right: left + frameWidth,
      color: mix('#3498db', '#2ecc71', share),
      alpha: lit ? 1 : lerp(0.35, 0.8, share),
      width: lit ? 2.6 : 1.2,
      glow: lit ? 1 : 0,
    };
  });
};

// the ends of the track (frame 1, the last frame) and the knob on it, each [x, y]
export const diagramTrack = () => {
  const at = (k: number): [number, number] => {
    const { left, zero } = diagramPlace(k);
    return [left - DIAGRAM.track, zero];
  };
  return { first: at(0), last: at(DIAGRAM.frames - 1), knob: at(DIAGRAM.played) };
};

// a frame as the points of an SVG polyline, and its area down to its zero line as those of a polygon
export const svgPoints = (xy: number[]) =>
  xy.reduce(
    (points, value, i) => points + (i % 2 ? `,${round(value)}` : `${i ? ' ' : ''}${round(value)}`),
    ''
  );

export const svgArea = (frame: ArtFrame) =>
  `${svgPoints(frame.xy)} ${round(frame.right)},${round(frame.zero)} ${round(frame.left)},${round(frame.zero)}`;

type RibbonLine = { d: string; opacity: number };

// voices of a unison: sines a little apart in pitch and phase under one envelope, the middle ones the brightest
export const ribbon = (width: number, height: number, voices = 9, samples = 120) =>
  Array.from({ length: voices }, (_, v): RibbonLine => {
    const offset = v - (voices - 1) / 2;
    const cycles = 2.2 + offset * 0.045;
    const phase = offset * 0.35;
    const d = Array.from({ length: samples + 1 }, (__, i) => {
      const x = i / samples;
      const envelope = Math.sin(Math.PI * x) ** 0.8;
      const y = height / 2 - envelope * (height * 0.4) * Math.sin(2 * Math.PI * cycles * x + phase);
      return `${i ? 'L' : 'M'}${round(x * width)} ${round(y)}`;
    }).join('');
    return { d, opacity: lerp(0.95, 0.25, Math.abs(offset) / ((voices - 1) / 2)) };
  });
