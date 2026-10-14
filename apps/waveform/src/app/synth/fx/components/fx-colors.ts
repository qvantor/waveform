import { FxType } from '@waveform/preset-schema';
import { theme } from '@waveform/ui-kit';

// the effect's own color in the effects list: the lamp, the icon and the left border of an added effect
export const FX_COLORS: Record<FxType, string> = {
  delay: theme.colors.secondAccent,
  reverb: theme.colors.accent,
};
