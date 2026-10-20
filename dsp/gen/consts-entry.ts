// the tables the TS cores work out when their modules load, which the Rust cores read as constants: dsp/gen/consts.mjs
// bundles this entry, runs it under jsmath and writes them into dsp/dsp-core/src/consts.rs
import { sincPhase } from '../../libs/math/src/filter/fir';
export { CEILING } from '../../apps/waveform/src/app/synth/common/limiter/limiter-dsp';
export {
  TRUE_PEAK_BOUND,
  TRUE_PEAK_PHASES,
} from '../../apps/waveform/src/app/synth/common/limiter/true-peak';
export { DOWN_PHASES, UP_PHASES } from '../../apps/waveform/src/app/synth/fx/effects/oversampler';
export { MAKEUP_TABLES } from '../../apps/waveform/src/app/synth/fx/effects/distortion-makeup';

// the 8× chain of the hard clip of the Rust core (the TS core stays at 4×): oversampler.ts at 8×, 32 taps per phase
// at the input rate as its 4× (the same latency), Kaiser β 5, up() cut at 0.9 × the nyquist, down() at the nyquist
export const UP8_PHASES = Array.from({ length: 8 }, (_, phase) => sincPhase(phase, 8, 32, 5, 0.9));
export const DOWN8_PHASES = Array.from({ length: 7 }, (_, phase) => sincPhase(phase + 1, 8, 32, 5));
