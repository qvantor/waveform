import { mapValues } from 'lodash';
import { ENVELOPE_CURVES } from '@waveform/preset-schema';
import type { EnvelopeParams } from '../app/synth/common/envelope/envelope-curve';
import { Envelopes, envelopeSeconds } from '../app/synth/common/modules/envelopes';

// an envelope with the curves of a fresh one: what the env model gives a note by default
export const withCurves = (env: EnvelopeParams): EnvelopeParams => ({ ...env, curves: ENVELOPE_CURVES });

// the envelopes of the knobs a note plays at 120 BPM (in MS their seconds)
export const played = (knobs: Envelopes) => mapValues(knobs, (envelope) => envelopeSeconds(envelope, 120));
