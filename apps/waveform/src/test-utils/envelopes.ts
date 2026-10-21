import { ENVELOPE_CURVES } from '@waveform/preset-schema';
import type { EnvelopeParams } from '../app/synth/common/envelope/envelope-curve';

// an envelope with the curves of a fresh one: what the env model gives a note by default
export const withCurves = (env: EnvelopeParams): EnvelopeParams => ({ ...env, curves: ENVELOPE_CURVES });
