// the tables the TS cores work out when their modules load, which the Rust cores read as constants: dsp/gen/consts.mjs
// bundles this entry, runs it under jsmath and writes them into dsp/dsp-core/src/consts.rs
export { CEILING } from '../../apps/waveform/src/app/synth/common/limiter/limiter-dsp';
export {
  TRUE_PEAK_BOUND,
  TRUE_PEAK_PHASES,
} from '../../apps/waveform/src/app/synth/common/limiter/true-peak';
export { DOWN_PHASES, UP_PHASES } from '../../apps/waveform/src/app/synth/fx/effects/oversampler';
export { MAKEUP_TABLES } from '../../apps/waveform/src/app/synth/fx/effects/distortion-makeup';
