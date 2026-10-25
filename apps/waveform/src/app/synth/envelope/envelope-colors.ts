import { ModSource } from '@waveform/preset-schema';

// the color of each source of the modulation: its tab, and the arcs and the amount dots of the knobs it
// modulates. Green, blue, purple and orange (the velocity) of the same lightness (0.65 in OKLCH, chroma 0.12):
// none of them stands out
export const ENVELOPE_COLORS: Record<ModSource, string> = {
  env1: '#3ca577',
  env2: '#4796d3',
  env3: '#ab77c1',
  velo: '#c47c3b',
};

export const ENVELOPE_LABELS: Record<ModSource, string> = {
  env1: 'ENV 1',
  env2: 'ENV 2',
  env3: 'ENV 3',
  velo: 'VELO',
};
