import { ModSource } from '@waveform/preset-schema';

// the color of each source of the modulation: its tab, and the arcs and the amount dots of the knobs it
// modulates. The envelopes green, blue and violet, the velocity gold, the LFOs rust, plum, cyan and pink: any two of
// them at least 18 apart in OKLab (×100) and 32° in hue, 9.7 for protanopia and deuteranopia, lightness 0.49..0.68
// (OKLCH; a few darker, a few lighter), dark enough for the white count in the dot of a tab (3:1 at least)
export const SOURCE_COLORS: Record<ModSource, string> = {
  env1: '#107350',
  env2: '#1663c7',
  env3: '#9c7ffc',
  velo: '#b69020',
  lfo1: '#b73611',
  lfo2: '#8e3690',
  lfo3: '#23a2bd',
  lfo4: '#eb608e',
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
