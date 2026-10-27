import { ModSource } from '@waveform/preset-schema';

// the color of each source of the modulation: its tab, and the arcs and the amount dots of the knobs it
// modulates. The envelopes green, blue and purple, the velocity orange, the LFOs red, olive, teal and pink, all of
// the same lightness (0.65 in OKLCH, chroma 0.12): none of them stands out
export const SOURCE_COLORS: Record<ModSource, string> = {
  env1: '#3ca577',
  env2: '#4796d3',
  env3: '#ab77c1',
  velo: '#c47c3b',
  lfo1: '#ce6f70',
  lfo2: '#9a932d',
  lfo3: '#00a4ac',
  lfo4: '#c56f99',
};

export const SOURCE_LABELS: Record<ModSource, string> = {
  env1: 'ENV 1',
  env2: 'ENV 2',
  env3: 'ENV 3',
  velo: 'VELO',
  lfo1: 'LFO 1',
  lfo2: 'LFO 2',
  lfo3: 'LFO 3',
  lfo4: 'LFO 4',
};
