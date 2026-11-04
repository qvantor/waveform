// The drawings of the page: a wavetable as a stack of its frames (a sine that grows into a saw, the back frames
// blue, the front green, as the logo), still in the SVG of the page and moving on a canvas over it (art.ts), and a
// ribbon of detuned sines (a unison). Pure math: the build and the browser run the same.

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 10) / 10;

// a color between two #rrggbb
export const mix = (from: string, to: string, t: number) => {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const value = [0, 1, 2].map((i) => Math.round(lerp(channel(from, i), channel(to, i), t)));
  return `#${value.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const HARMONICS = 14;

// frame t (0..1) of the table at x (periodic over 0..1): the fundamental, the harmonics coming in one after another
// as t grows (each over its own share of t), so the first frame is a sine and the last a saw
export const frameAt = (t: number, x: number) => {
  let y = 0;
  for (let h = 1; h <= HARMONICS; h++) {
    const gain = h === 1 ? 1 : clamp(t * HARMONICS - (h - 2));
    y += (gain * Math.sin(2 * Math.PI * h * x)) / h;
  }
  return y;
};

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

// the motion, in seconds: the frames slide sideways in a wave that runs back through the stack (a lag per frame),
// their shapes breathe between the sine and the saw, the frame the Wave knob plays sweeps over the stack
export const MOTION = {
  slide: { amount: 0.07, period: 9, lag: 0.24 },
  breath: { amount: 0.12, period: 14, lag: 0.15 },
  sweep: { span: 0.4, period: 11 },
};

const wave = (time: number, period: number, lag = 0) => Math.sin((2 * Math.PI * time) / period - lag);

// a frame at a time: its points (x, y in turn), its zero line and ends (the area of a played frame), its color,
// how opaque its line is and how much it is the played frame (`glow` 0..1: the sweep between two frames lights both)
export type ArtFrame = {
  xy: number[];
  zero: number;
  left: number;
  right: number;
  color: string;
  alpha: number;
  glow: number;
};

export const artFrames = (time = 0): ArtFrame[] => {
  const { frames, samples, width, amplitude, depth, origin } = STACK;
  const { slide, breath, sweep } = MOTION;
  const played = (0.5 + sweep.span * wave(time, sweep.period)) * (frames - 1);
  return Array.from({ length: frames }, (_, k) => {
    const share = k / (frames - 1);
    const t = clamp(share + breath.amount * wave(time, breath.period, breath.lag * k));
    const shift = slide.amount * wave(time, slide.period, slide.lag * k);
    const values = Array.from({ length: samples + 1 }, (__, i) => frameAt(t, i / samples + shift));
    const peak = Math.max(...values.map(Math.abs)) || 1;
    const back = frames - 1 - k;
    const left = origin[0] + back * depth[0];
    const zero = origin[1] - back * depth[1];
    const xy = values.flatMap((value, i) => [
      left + (i / samples) * width,
      zero - (value / peak) * amplitude,
    ]);
    const glow = Math.max(0, 1 - Math.abs(k - played));
    const base = lerp(0.28, 0.8, share);
    return {
      xy,
      zero,
      left,
      right: left + width,
      color: mix('#3498db', '#2ecc71', share),
      alpha: lerp(base, 1, glow),
      glow,
    };
  });
};

// a frame as the points of an SVG polyline, and its area down to its zero line as those of a polygon
export const svgPoints = (xy: number[]) =>
  xy.reduce(
    (points, value, i) => points + (i % 2 ? `,${round(value)}` : `${i ? ' ' : ''}${round(value)}`),
    ''
  );

export const svgArea = (frame: ArtFrame) =>
  `${svgPoints(frame.xy)} ${round(frame.right)},${round(frame.zero)} ${round(frame.left)},${round(frame.zero)}`;

export type RibbonLine = { d: string; opacity: number };

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
