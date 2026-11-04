import { frameAt, mix } from './wavetable';

// The waves behind the features: each shows what its part of the synth does to a wave, slowly moving (scripts/
// scenes.ts draws them on a canvas behind the section). Pure math: a scene at a time is its lines, each points of
// x (0..1 across the section) and a level (-1..1 around the middle of its band), a color, how opaque and how
// thick, a glow; the editor's pen a dot.

export const SCENES = [
  'wavetables',
  'unison',
  'filter',
  'modulation',
  'effects',
  'playing',
  'editor',
  'presets',
] as const;
export type Scene = (typeof SCENES)[number];

export const isScene = (name: string): name is Scene => (SCENES as readonly string[]).includes(name);

export type SceneLine = {
  points: number[];
  color: string;
  alpha: number;
  width: number;
  glow?: number;
  dash?: number[];
  dot?: [number, number];
};

const TAU = 2 * Math.PI;
const BLUE = '#3498db';
const GREEN = '#2ecc71';
const GHOST = '#5a7fa4';
// the colors of the sources of the routes (the tabs of the synth)
const SOURCES = ['#2ecc71', '#3498db', '#9b59b6', '#f1c40f', '#e74c3c', '#1abc9c'];
const SAMPLES = 240;

const slow = (time: number, period: number, lag = 0) => Math.sin((TAU * time) / period - lag);
const share = (time: number, period: number) => 0.5 + 0.5 * slow(time, period);

// a line of `level` over x in [from, to]
const curve = (level: (x: number) => number, from = 0, to = 1, samples = SAMPLES) =>
  Array.from({ length: samples + 1 }, (_, i) => {
    const x = from + ((to - from) * i) / samples;
    return [x, level(x)];
  }).flat();

// a saw of its first harmonics, each weighted (the filter): Σ gain(h)·sin(2πhx)/h
const partials = (x: number, harmonics: number, gain: (h: number) => number = () => 1) => {
  let y = 0;
  for (let h = 1; h <= harmonics; h++) y += (gain(h) * Math.sin(TAU * h * x)) / h;
  return y;
};

// the largest |level| of a periodic level over one period
const peakOf = (level: (x: number) => number, samples = 256) =>
  Math.max(...Array.from({ length: samples }, (_, i) => Math.abs(level(i / samples))));

// the peak of a saw of 24 harmonics: the scale of the filter's waves
const SAW_PEAK = peakOf((x) => partials(x, 24), 1024);
const UNISON_PEAK = peakOf((x) => partials(x, 6), 1024);

// the position of the Wave knob moving through the frames of a table: its frames faint, the one it plays bright
const TABLE_CYCLES = 3;
// the frames of the table, still: worked out once
const TABLE_FRAMES = [0, 0.33, 0.66, 1].map((t): SceneLine => {
  const peak = peakOf((x) => frameAt(t, x));
  return { points: curve((x) => frameAt(t, TABLE_CYCLES * x) / peak), color: GHOST, alpha: 0.35, width: 1 };
});

const wavetables = (time: number): SceneLine[] => {
  const cycles = TABLE_CYCLES;
  const frames = TABLE_FRAMES;
  const played = share(time, 14);
  const peak = peakOf((x) => frameAt(played, x), 128);
  return [
    ...frames,
    {
      points: curve((x) => frameAt(played, cycles * x) / peak),
      color: mix(BLUE, GREEN, played),
      alpha: 0.95,
      width: 2,
      glow: 10,
    },
  ];
};

// voices of one wave a little apart in pitch: together in the middle, apart towards the edges, their phases drifting
const unison = (time: number): SceneLine[] => {
  const voices = 7;
  return Array.from({ length: voices }, (_, v) => {
    const offset = (v - (voices - 1) / 2) / ((voices - 1) / 2);
    const cycles = 3.2 * (1 + 0.05 * offset);
    const drift = 0.12 * offset * slow(time, 16);
    const centre = offset === 0;
    return {
      points: curve((x) => partials(cycles * (x - 0.5) + drift + 0.25, 6) / UNISON_PEAK),
      color: centre ? GREEN : mix(BLUE, GREEN, 0.5 - 0.5 * Math.abs(offset)),
      alpha: centre ? 0.95 : 0.65 - 0.3 * Math.abs(offset),
      width: centre ? 2 : 1.2,
      glow: centre ? 10 : 0,
    };
  });
};

// a saw and what a resonant lowpass leaves of it, the cutoff going up and down
const filter = (time: number): SceneLine[] => {
  const cycles = 3;
  const cutoff = 1.6 + 7 * share(time, 12);
  const gain = (h: number) =>
    (1 / Math.sqrt(1 + (h / cutoff) ** 8)) * (1 + 1.4 * Math.exp(-((h - cutoff) ** 2) / 0.9));
  return [
    { points: curve((x) => partials(cycles * x, 24) / SAW_PEAK), color: GHOST, alpha: 0.4, width: 1 },
    {
      points: curve((x) => partials(cycles * x, 24, gain) / SAW_PEAK),
      color: '#f1c40f',
      alpha: 0.9,
      width: 2,
      glow: 10,
    },
  ];
};

// a wave under the shape of an LFO moving along it: the shape bright, the wave it moves faint
const modulation = (time: number): SceneLine[] => {
  const shape = (x: number) => 0.18 + 0.82 * (0.5 + 0.5 * Math.sin(TAU * (1.2 * x - time / 9)));
  return [
    {
      points: curve((x) => shape(x) * Math.sin(TAU * 18 * x), 0, 1, 720),
      color: BLUE,
      alpha: 0.55,
      width: 1.1,
    },
    { points: curve(shape), color: '#9b59b6', alpha: 0.95, width: 2, glow: 10 },
    { points: curve((x) => -shape(x)), color: '#9b59b6', alpha: 0.6, width: 1.4 },
  ];
};

// a sine and the distortion's soft clip of it, the drive going up and down, the ceiling dashed
const effects = (time: number): SceneLine[] => {
  const cycles = 2.5;
  const drive = 1 + 6 * share(time, 10);
  const ceiling = 0.82;
  return [
    {
      points: curve((x) => Math.sin(TAU * cycles * x)),
      color: GHOST,
      alpha: 0.4,
      width: 1,
    },
    { points: [0, ceiling, 1, ceiling], color: '#e74c3c', alpha: 0.35, width: 1, dash: [6, 8] },
    { points: [0, -ceiling, 1, -ceiling], color: '#e74c3c', alpha: 0.35, width: 1, dash: [6, 8] },
    {
      points: curve((x) => (ceiling * Math.tanh(drive * Math.sin(TAU * cycles * x))) / Math.tanh(drive)),
      color: '#e74c3c',
      alpha: 0.9,
      width: 2,
      glow: 10,
    },
  ];
};

// notes that glide into each other (portamento), passing by
const NOTES = [3, 4.5, 3.6, 5.4, 4, 3];
const glide = (position: number) => {
  // the pitch (cycles over the width) at a position of a loop of the notes, each gliding over the last third
  const steps = NOTES.length;
  const p = (((position % 1) + 1) % 1) * steps;
  const i = Math.floor(p);
  const into = Math.max(0, (p - i - 0.66) / 0.34);
  const eased = into * into * (3 - 2 * into);
  return NOTES[i] + (NOTES[(i + 1) % steps] - NOTES[i]) * eased;
};
const playing = (time: number): SceneLine[] => {
  const offset = time / 40;
  const samples = 480;
  let phase = 0;
  const points: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    if (i) phase += glide(x / 1.5 + offset) / samples;
    points.push(x, 0.85 * Math.sin(TAU * phase));
  }
  return [{ points, color: '#1abc9c', alpha: 0.9, width: 2, glow: 10 }];
};

// a wave drawn by hand, point by point, a pen going along it
const DRAWN = [
  [0, 0],
  [0.06, 0.55],
  [0.12, 0.3],
  [0.2, 0.85],
  [0.28, 0.15],
  [0.36, -0.45],
  [0.43, -0.15],
  [0.5, -0.8],
  [0.58, -0.35],
  [0.66, 0.5],
  [0.74, 0.25],
  [0.82, -0.55],
  [0.9, -0.2],
  [1, 0],
];
const drawnAt = (x: number) => {
  const period = ((x % 1) + 1) % 1;
  const i = DRAWN.findIndex(([px]) => px >= period);
  if (i <= 0) return DRAWN[0][1];
  const [x0, y0] = DRAWN[i - 1];
  const [x1, y1] = DRAWN[i];
  const t = (period - x0) / (x1 - x0);
  // smooth between the points (a cosine ease)
  return y0 + (y1 - y0) * (0.5 - 0.5 * Math.cos(Math.PI * t));
};
const editor = (time: number): SceneLine[] => {
  const cycles = 2;
  const pen = (time / 12) % 1;
  const level = (x: number) => drawnAt(cycles * x);
  return [
    { points: curve(level), color: GHOST, alpha: 0.35, width: 1 },
    {
      points: curve(level, 0, Math.max(pen, 0.001), Math.max(2, Math.round(SAMPLES * pen))),
      color: GREEN,
      alpha: 0.95,
      width: 2,
      glow: 10,
      dot: [pen, level(pen)],
    },
  ];
};

// a shelf of different sounds: six small waves side by side, drifting
const SHAPES: ((x: number) => number)[] = [
  (x) => Math.sin(TAU * x),
  (x) => partials(x, 8) / 1.6,
  (x) => partials(x, 9, (h) => (h % 2 ? 1 : 0)) / 0.9,
  (x) => (2 / Math.PI) * Math.asin(Math.sin(TAU * x)),
  (x) => Math.exp(-3 * (((x % 1) + 1) % 1)) * Math.sin(TAU * 3 * x),
  (x) => (Math.sin(TAU * x) + 0.5 * Math.sin(TAU * 3.7 * x + 1) + 0.3 * Math.sin(TAU * 7.3 * x + 2)) / 1.5,
];
const presets = (time: number): SceneLine[] =>
  SHAPES.map((shape, i) => {
    const from = i / SHAPES.length + 0.02;
    const to = (i + 1) / SHAPES.length - 0.02;
    const drift = time / 18 + i * 0.13;
    return {
      points: curve((x) => 0.7 * shape(((x - from) / (to - from)) * 1.5 + drift), from, to, 80),
      color: SOURCES[i],
      alpha: 0.85,
      width: 1.8,
      glow: 8,
    };
  });

const DRAW: Record<Scene, (time: number) => SceneLine[]> = {
  wavetables,
  unison,
  filter,
  modulation,
  effects,
  playing,
  editor,
  presets,
};

export const sceneAt = (scene: Scene, time: number) => DRAW[scene](time);
