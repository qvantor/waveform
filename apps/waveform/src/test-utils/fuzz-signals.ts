// the random inputs of the fuzzers of the stereo cores (the parity specs): a signal of a few parts, each its own
// kind (silence, tones over and under full scale, noise, steps, clicks, DC, denormals and the values a broken
// graph sends: NaN, infinities), different on the two channels; the blocks of a render, mostly quanta of 128

export type Random = () => number;
export type Signal = (frame: number, channel: number) => number;

export const pick = <T>(random: Random, items: readonly T[]) => items[Math.floor(random() * items.length)];

// a gain of -60..+30 dB, more of them loud
const level = (random: Random) => 10 ** ((random() * 90 - 60) / 20);

const part = (random: Random, rate: number, specials: boolean): Signal => {
  const amplitude = level(random);
  let kind = Math.floor(random() * 10);
  if (kind === 8 && !specials) kind = 1;
  switch (kind) {
    case 0:
      return () => 0;
    case 1:
    case 2: {
      const freq = 20 * 2 ** (random() * 10.2);
      const phase = random() * 2 * Math.PI;
      return (n, channel) => amplitude * Math.sin((2 * Math.PI * freq * n) / rate + phase + channel);
    }
    case 3: {
      // noise, its own on each side
      let seed = Math.floor(random() * 2147483646) + 1;
      return () => {
        seed = (seed * 16807) % 2147483647;
        return amplitude * ((seed / 2147483647) * 2 - 1);
      };
    }
    case 4: {
      const period = 1 + Math.floor(random() * 400);
      return (n) => (Math.floor(n / period) % 2 ? amplitude : -amplitude);
    }
    case 5: {
      // clicks: single samples
      const every = 1 + Math.floor(random() * 300);
      return (n) => (n % every === 0 ? amplitude : 0);
    }
    case 6:
      return (_, channel) => (channel ? -amplitude : amplitude);
    case 7:
      // denormals of float32
      return (n) => ((n % 3) - 1) * 1e-40;
    case 8: {
      const special = pick(random, [NaN, Infinity, -Infinity, 1e30, -1e30]);
      const every = 1 + Math.floor(random() * 200);
      return (n) => (n % every === 0 ? special : 0);
    }
    default: {
      // a sine at fs/4 sampled off its peaks: the peaks fall between the samples
      const shift = random() * Math.PI;
      return (n) => amplitude * Math.sin((Math.PI / 2) * n + shift);
    }
  }
};

// a signal of 1..3 parts, each from a random frame on, mixed or one after another. `specials`: NaN, infinities and
// 1e30 too (the limiter takes them as silence; the effects before it never get them: their TS cores pass them on)
export const randomSignal = (random: Random, rate: number, frames: number, specials = true): Signal => {
  const parts = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
    signal: part(random, rate, specials),
    from: random() < 0.5 ? 0 : Math.floor(random() * frames),
    until: random() < 0.5 ? Infinity : Math.floor(random() * frames * 1.5),
  }));
  return (n, channel) =>
    parts.reduce(
      (sum, { signal, from, until }) => (n >= from && n < until ? sum + signal(n, channel) : sum),
      0
    );
};

// the lengths of the blocks of a render of about `frames`: mostly quanta, some of another length (the cores grow
// their buffers)
export const randomBlocks = (random: Random, frames: number) => {
  const blocks: number[] = [];
  let total = 0;
  while (total < frames) {
    const length = random() < 0.8 ? 128 : 1 + Math.floor(random() * 1024);
    blocks.push(length);
    total += length;
  }
  return blocks;
};

export const RATES = [22050, 44100, 48000, 88200, 96000] as const;
