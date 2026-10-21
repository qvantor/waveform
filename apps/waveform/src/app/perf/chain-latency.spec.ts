import { oscScope } from '../../test-utils/voice-dsp';
import { wasmCore } from '../../test-utils/wasm';
import { createLimiterWasm, LimiterExports } from '../synth/common/limiter/limiter-wasm';
import { buildLevels } from '../synth/common/wavetable/wavetable-mipmap';
import {
  createTableStoreWasm,
  createVoiceSharedWasm,
  createVoiceWasm,
} from '../synth/common/wavetable/wavetable-osc-wasm';
import type { EnvelopeParams } from '../synth/common/envelope/envelope-curve';
import { VoiceParam } from '../synth/common/wavetable/wavetable-osc-params';
import { DISTORTION_LATENCY, TONE_OPEN } from '../synth/fx/effects/distortion-params';
import { createDistortionWasm, DistortionExports } from '../synth/fx/effects/distortion-wasm';
import { createOnsetDetector, PROBE_DEFAULTS } from './probe-dsp';

// the latency the synth adds to a note, worked out offline (it replaces the chain latency the browser suite
// measured with its probe): the voice starts at the frame of the note on, the filter (a native biquad), the
// delay and the reverb add none to the dry path, the distortion delays both its wet and its dry signal by
// DISTORTION_LATENCY (the dry through the DelayNode of its slot), the limiter by its lookahead and the delay of
// its true peak detector. What the browser and the device add (the render lag, the output) is measured by the
// browser suite (scripts/bench-perf, L1 and L3)

const BLOCK = 128;
const RATES = [44100, 48000, 96000];
// the Rust cores, an instance each for the spec (a scope)
const limiterCore = wasmCore<LimiterExports>('limiter');
const distortionCore = wasmCore<DistortionExports>('distortion');
const createLimiterDsp = (rate: number) => createLimiterWasm(limiterCore, rate);
// the latency of the oversampler of the distortion: half of it is its interpolation, half its decimation
const OVERSAMPLER_LATENCY = DISTORTION_LATENCY;

// a mild drive: the curve is about linear for a signal of 0.25
const DISTORTION = { mode: 0, drive: 0, tone: TONE_OPEN, level: 0 };

// renders `input` (frame → sample, both channels) through the distortion and the limiter in render quanta;
// the input and the output
const renderChain = (rate: number, frames: number, input: (frame: number) => number) => {
  const distortion = createDistortionWasm(distortionCore, rate, { params: DISTORTION });
  const limiter = createLimiterDsp(rate);
  const dry = Float32Array.from({ length: frames }, (_, frame) => input(frame));
  const out = new Float32Array(frames);
  const [mid, right, outRight] = [0, 1, 2].map(() => new Float32Array(BLOCK));
  for (let start = 0; start < frames; start += BLOCK) {
    const block = dry.subarray(start, start + BLOCK);
    distortion.process(block, block, mid, right);
    limiter.process(mid, right, out.subarray(start, start + BLOCK), outRight);
  }
  return { dry, out, chain: limiter.latency + DISTORTION_LATENCY };
};

const loudest = (data: Float32Array) =>
  data.reduce((best, value, i) => (Math.abs(value) > Math.abs(data[best]) ? i : best), 0);

// the onsets the probe of the perf build hears in a signal (frames)
const onsets = (data: Float32Array) => {
  const detect = createOnsetDetector(PROBE_DEFAULTS);
  const found: number[] = [];
  for (let start = 0; start < data.length; start += BLOCK) {
    const onset = detect([data.subarray(start, start + BLOCK)], Math.min(BLOCK, data.length - start));
    if (onset >= 0) found.push(start + onset);
  }
  return found;
};

const SINE = Array.from({ length: 2048 }, (_, n) => Math.sin((2 * Math.PI * n) / 2048));
const PARAMS = Object.fromEntries(
  Object.entries({
    frequency: 440,
    gate: 1,
    position1: 0,
    position2: 0,
    detune1: 0,
    detune2: 0,
    spread1: 0,
    spread2: 0,
    gain1: 0.25,
    gain2: 0,
  }).map(([name, value]) => [name, Float32Array.of(value)])
) as Record<VoiceParam, Float32Array>;

// ENV 1 at full level from the start: the voice as the oscillator plays it
const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };

// a note at `start` (seconds): its voice at phase rand 0 from a quarter of the sine (its peak), left channel
const renderVoice = (rate: number, frames: number, start: number) => {
  const scope = oscScope();
  const store = createTableStoreWasm(scope);
  store.set('a', 1, buildLevels([SINE]));
  const voice = createVoiceWasm(
    scope,
    rate,
    {
      osc: [{ table: 'a', unison: 1, phase: 0.25, phaseRand: 0 }, null],
      start,
      envelopes: [FLAT, FLAT, FLAT],
      envStart: start,
      phrase: 0,
      routes: [],
      filter: null,
    },
    store,
    () => 0,
    createVoiceSharedWasm(scope)
  );
  const out = new Float32Array(frames);
  const right = new Float32Array(BLOCK);
  for (let frame = 0; frame < frames; frame += BLOCK)
    voice.process(frame, PARAMS, out.subarray(frame, frame + BLOCK), right);
  return { out, voice };
};

describe('the latency of the chain', () => {
  it.each([
    [44100, 104, 136],
    [48000, 112, 144],
    [96000, 208, 240],
  ])(
    'at %i Hz: an impulse comes out of the distortion and the limiter %i + 32 = %i frames later',
    (rate, limiter, chain) => {
      expect(createLimiterDsp(rate).latency).toBe(limiter);
      const at = 300;
      const { out, chain: expected } = renderChain(rate, 2048, (frame) => (frame === at ? 0.25 : 0));
      expect(expected).toBe(chain);
      expect(loudest(out) - at).toBe(chain);
    }
  );

  it.each(RATES)(
    'at %i Hz the dry signal of the distortion slot is delayed by the same 32 frames',
    (rate) => {
      // the delay time of the slot (distortion.ts: latency in seconds) is a float32 AudioParam
      expect(Math.abs(Math.fround(DISTORTION_LATENCY / rate) * rate - DISTORTION_LATENCY)).toBeLessThan(1e-5);
    }
  );

  it.each(RATES)(
    'at %i Hz the probe hears a note through the chain at most 16 frames before its latency',
    (rate) => {
      const frames = 4096;
      const { out: voice } = renderVoice(rate, frames, 1000 / rate);
      const { out, chain } = renderChain(rate, frames, (frame) => voice[frame]);
      const [heard] = onsets(voice);
      const [through] = onsets(out);
      expect(heard).toBe(1000);
      // the interpolator of the oversampler rings ahead of its peak (linear phase): the onset crosses the
      // threshold of the probe up to half its taps at the input rate early
      expect(through - heard).toBeLessThanOrEqual(chain);
      expect(through - heard).toBeGreaterThanOrEqual(chain - OVERSAMPLER_LATENCY / 2);
    }
  );

  it.each([
    [44100, 3.084],
    [48000, 3],
    [96000, 2.5],
  ])('at %i Hz a note leaves the limiter %f ms after the frame of its note on, within 3.1 ms', (rate, ms) => {
    // the note on schedules the voice at the context time (synth.ts): it starts at that frame
    const start = 777 / rate;
    const { voice } = renderVoice(rate, 2048, start);
    expect(voice.startedAt).toBe(voice.startFrame);
    expect(voice.startFrame).toBe(777);
    const { chain } = renderChain(rate, BLOCK, () => 0);
    const latency = ((voice.startedAt - voice.startFrame + chain) / rate) * 1000;
    expect(latency).toBeCloseTo(ms, 3);
    expect(latency).toBeLessThanOrEqual(3.1);
  });
});
