import { EnvelopeId } from '@waveform/preset-schema';
import { theme } from '@waveform/ui-kit';

// the color of each envelope: its tab, and the arcs and the amount rings of the knobs it modulates
export const ENVELOPE_COLORS: Record<EnvelopeId, string> = {
  env1: theme.colors.secondAccent,
  env2: theme.colors.thirdAccent,
  env3: theme.colors.fourthAccent,
};

export const ENVELOPE_LABELS: Record<EnvelopeId, string> = { env1: 'ENV 1', env2: 'ENV 2', env3: 'ENV 3' };
