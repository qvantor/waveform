import { number } from '@waveform/math';

// the octaves of the keys on the screen: the piano of the desktop, the tiers of the phone
const PIANO_OCTAVES: [number, number] = [0, 8];

// the octaves `count` octaves of keys can start at
export const pianoStarts = (count: number): [number, number] => [
  PIANO_OCTAVES[0],
  PIANO_OCTAVES[1] - count + 1,
];

// the `count` octaves the piano of the desktop shows: from the one under the bottom row of the computer keyboard
// (2–6 by default), within PIANO_OCTAVES
export const pianoOctaves = (octave: number, count: number): [number, number] => {
  const first = number.thresholds(octave - 1, ...pianoStarts(count));
  return [first, first + count - 1];
};
