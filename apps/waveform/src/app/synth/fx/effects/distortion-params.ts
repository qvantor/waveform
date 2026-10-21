// the params, the options and the messages of the distortion (its Rust core, dsp/distortion: distortion-wasm.ts),
// no signal processing here

// the distortion params (FX_PARAMS.distortion): mode index, drive (dB), tone (Hz), level (dB, on top of the
// makeup gain)
export interface DistortionDspParams {
  mode: number;
  drive: number;
  tone: number;
  level: number;
}

export interface DistortionOptions {
  params: DistortionDspParams;
}

// main thread → worklet: changed params
export interface DistortionMessage {
  params?: Partial<DistortionDspParams>;
}

// samples the output lags the input: the oversampling filters (4× and the 8× of the hard clip, 32 taps a phase
// at the input rate each) are linear phase, the fx slot delays the dry signal as much, so the mix doesn't comb
// filter
export const DISTORTION_LATENCY = 32;

// the top of the tone range (FX_PARAMS.distortion.tone.max, not imported: it would bundle zod) is open: the
// lowpass is faded out, so the wet signal keeps the phase of the dry one (a 20 kHz lowpass still delays the
// highs by half a sample, the mix would dull them)
export const TONE_OPEN = 20000;

// Hz of the dc blocker, the last stage
export const DC_CUTOFF = 5;

// the peak of the reference sine of the makeup gains (a note at the fx input): its RMS is kept at every drive while
// it is not clipped, then the gain levels off (-9 dB, -7.1 dB soft and -8 dB hard at the top of the drive)
export const REFERENCE_PEAK = 0.5;
