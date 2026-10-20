// the page of the oscillator benchmark (run.mjs bundles it with esbuild and opens it in Chromium, WebKit and
// Firefox): the wavetable oscillator worklet against a native OscillatorNode with the PeriodicWave of the
// same frame, rendered in OfflineAudioContexts. Each function returns plain numbers, run.mjs checks them
// against the criteria of the spec
import FFT from 'fft.js';
import { wave } from '@waveform/math';
import { buildLevels } from '../../apps/waveform/src/app/synth/common/wavetable/wavetable-mipmap';
import type { WavetableLevels } from '../../apps/waveform/src/app/synth/common/wavetable/wavetable-levels';
import {
  createTableStore,
  createVoiceDsp,
} from '../../apps/waveform/src/app/synth/common/wavetable/wavetable-osc-dsp';
import {
  STORE_PROCESSOR,
  VOICE_PROCESSOR,
  VoiceParam,
} from '../../apps/waveform/src/app/synth/common/wavetable/wavetable-osc-params';
import { parseWav } from '../../apps/waveform/src/app/synth/services/wav';

const WORKLET_URL = 'wavetable-osc.js';
const WAVE_SIZE = 2048;
// samples of a spectrum, the render plays this many more before it (the start of the note is left out)
const SIZE = 65536;
const LEAD = 8192;
const BLOCK = 128;

type Frames = number[][];

// a band-limited saw of 2048 samples, every harmonic at 1/k
const sawFrame = () => {
  const frame = new Array<number>(WAVE_SIZE).fill(0);
  for (let k = 1; k < WAVE_SIZE / 2; k++)
    for (let n = 0; n < WAVE_SIZE; n++) frame[n] += Math.sin((2 * Math.PI * k * n) / WAVE_SIZE) / k;
  return frame;
};

const loadTable = async (url: string): Promise<Frames> => {
  const { samples } = parseWav(await (await fetch(url)).arrayBuffer());
  const frames: Frames = [];
  for (let i = 0; (i + 1) * WAVE_SIZE <= samples.length && i < 256; i++)
    frames.push([...samples.subarray(i * WAVE_SIZE, (i + 1) * WAVE_SIZE)]);
  return frames;
};

const tables = new Map<string, Frames>();
const table = async (name: string) => {
  const cached = tables.get(name);
  if (cached) return cached;
  const frames = name === 'saw' ? [sawFrame()] : await loadTable(`tables/${encodeURIComponent(name)}`);
  tables.set(name, frames);
  return frames;
};

// --- rendering ---

const nativeRender = async (
  rate: number,
  length: number,
  frame: number[],
  frequency: number,
  automate?: (osc: OscillatorNode) => void
) => {
  const ctx = new OfflineAudioContext(1, length, rate);
  const [real, imag] = wave.realWithImag(frame);
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
  osc.frequency.value = frequency;
  automate?.(osc);
  osc.connect(ctx.destination);
  osc.start(0);
  return (await ctx.startRendering()).getChannelData(0);
};

// the store of a context with the tables in it (the ack arrives before the rendering starts)
const createStore = async (ctx: BaseAudioContext, levels: Record<string, WavetableLevels>) => {
  await ctx.audioWorklet.addModule(WORKLET_URL);
  const node = new AudioWorkletNode(ctx, STORE_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1 });
  for (const [id, value] of Object.entries(levels)) await storeTable(node, id, 1, value);
  return node;
};

const storeTable = (node: AudioWorkletNode, table: string, version: number, levels: WavetableLevels) =>
  new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('the store did not answer')), 5000);
    node.port.onmessage = ({ data }) => {
      if (data.stored !== table || data.version !== version) return;
      clearTimeout(timeout);
      resolve();
    };
    // a copy: the levels are rendered again by other contexts
    node.port.postMessage({ table, version, levels });
  });

interface VoiceSetup {
  unison?: number;
  phaseRand?: number;
  table?: string;
  params?: Partial<Record<VoiceParam, number>>;
  start?: number;
  stop?: number;
  // ENV 1–3 and the routes of the voice (the first setup's)
  envelopes?: typeof ENVELOPES;
  routes?: { env: number; param: string; amount: number; min: number; max: number }[];
}

// ENV 1 at full level from the start of the note and ended at once by the gate, ENV 2 and 3 not read: the
// oscillators as they play
const FLAT = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const ENVELOPES = [FLAT, FLAT, FLAT];

const createVoice = (ctx: BaseAudioContext, setup: VoiceSetup, second?: VoiceSetup) => {
  const osc = (config: VoiceSetup) => ({
    table: config.table ?? 'a',
    unison: config.unison ?? 1,
    phase: 0,
    phaseRand: config.phaseRand ?? 0,
  });
  const node = new AudioWorkletNode(ctx, VOICE_PROCESSOR, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      osc: [osc(setup), second ? osc(second) : null],
      start: setup.start ?? 0,
      envelopes: setup.envelopes ?? ENVELOPES,
      envStart: setup.start ?? 0,
      phrase: 0,
      routes: setup.routes ?? [],
      filter: null,
    },
    parameterData: { gain1: 1, gain2: 1, ...setup.params, ...second?.params },
  });
  // the end of the note: its gate drops to 0 (ENV 1 has no release)
  if (setup.stop !== undefined) (node.parameters.get('gate') as AudioParam).setValueAtTime(0, setup.stop);
  return node;
};

const oursRender = async (
  rate: number,
  length: number,
  levels: Record<string, WavetableLevels>,
  setup: VoiceSetup,
  automate?: (voice: AudioWorkletNode, ctx: OfflineAudioContext, store: AudioWorkletNode) => void
) => {
  const ctx = new OfflineAudioContext(2, length, rate);
  const store = await createStore(ctx, levels);
  const voice = createVoice(ctx, setup);
  automate?.(voice, ctx, store);
  voice.connect(ctx.destination);
  const buffer = await ctx.startRendering();
  return [buffer.getChannelData(0), buffer.getChannelData(1)];
};

// the dsp itself in the page: stationary renders to compare a sweep against
const dspRender = (
  rate: number,
  levels: WavetableLevels,
  frames: number,
  params: Partial<Record<VoiceParam, number>>
) => {
  const store = createTableStore();
  store.set('a', 1, levels);
  const dsp = createVoiceDsp(
    rate,
    {
      osc: [{ table: 'a', unison: 1, phase: 0, phaseRand: 0 }, null],
      start: 0,
      envelopes: ENVELOPES,
      envStart: 0,
      phrase: 0,
      routes: [],
      filter: null,
    },
    store
  );
  const values = Object.fromEntries(
    [
      'frequency',
      'gate',
      'position1',
      'detune1',
      'spread1',
      'gain1',
      'position2',
      'detune2',
      'spread2',
      'gain2',
    ].map((name) => [
      name,
      Float32Array.of(
        (params as Record<string, number>)[name] ?? (name.startsWith('gain') || name === 'gate' ? 1 : 0)
      ),
    ])
  ) as Record<VoiceParam, Float32Array>;
  const out = new Float32Array(frames);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  for (let frame = 0; frame < frames; frame += BLOCK) {
    dsp.process(frame, values, left, right);
    out.set(left.subarray(0, Math.min(BLOCK, frames - frame)), frame);
  }
  return out;
};

// --- analysis ---

const besselI0 = (x: number) => {
  let sum = 1;
  let term = 1;
  for (let k = 1; term > sum * 1e-17; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
};
// a Kaiser window of β = 38: its sidelobes are far below any aliasing (−300 dB), its main lobe ±12 bins
const BETA = 38;
const BAND = 14;
const windows = new Map<number, Float64Array>();
const kaiser = (n: number) => {
  const cached = windows.get(n);
  if (cached) return cached;
  const window = Float64Array.from(
    { length: n },
    (_, i) => besselI0(BETA * Math.sqrt(1 - ((2 * i) / (n - 1) - 1) ** 2)) / besselI0(BETA)
  );
  windows.set(n, window);
  return window;
};

const powerSpectrum = (signal: Float32Array) => {
  const window = kaiser(SIZE);
  const fft = new FFT(SIZE);
  const input = new Float64Array(SIZE);
  const from = signal.length - SIZE;
  for (let i = 0; i < SIZE; i++) input[i] = signal[from + i] * window[i];
  const out = fft.createComplexArray();
  fft.realTransform(out, input as unknown as number[]);
  return Float64Array.from({ length: SIZE / 2 }, (_, k) => out[2 * k] ** 2 + out[2 * k + 1] ** 2);
};

// aliasing: the power outside the bands of the harmonics against their power; spur: the loudest bin
// outside them against the fundamental; highest: the number of the highest harmonic played at half its
// amplitude in the frame at least (against the loudest one; harmonics 80 dB below it don't count); rms of
// the analysed samples
const analyze = (signal: Float32Array, frequency: number, rate: number, frame: number[]) => {
  const spectrum = powerSpectrum(signal);
  const [real, imag] = wave.realWithImag(frame);
  const expected = real.map((a, k) => Math.hypot(a, imag[k]));
  const loudest = expected.indexOf(Math.max(...expected));
  const bands: number[] = [];
  const binsPerHz = SIZE / rate;
  const inBand = new Uint8Array(spectrum.length);
  let harmonics = 0;
  let fundamentalPeak = 0;
  let highest = 0;
  for (let h = 1; h * frequency < rate / 2; h++) {
    const center = Math.round(h * frequency * binsPerHz);
    let power = 0;
    for (let k = Math.max(0, center - BAND); k <= Math.min(spectrum.length - 1, center + BAND); k++) {
      inBand[k] = 1;
      power += spectrum[k];
      if (h === 1) fundamentalPeak = Math.max(fundamentalPeak, spectrum[k]);
    }
    bands[h] = power;
    harmonics += power;
  }
  for (let h = 1; h < bands.length && h < expected.length; h++) {
    if (expected[h] < expected[loudest] * 1e-4) continue;
    const played = Math.sqrt(bands[h] / bands[loudest]) / (expected[h] / expected[loudest]);
    if (played >= 0.5) highest = h;
  }
  let other = 0;
  let worst = 0;
  for (let k = BAND + 1; k < spectrum.length; k++) {
    if (inBand[k]) continue;
    other += spectrum[k];
    worst = Math.max(worst, spectrum[k]);
  }
  let squares = 0;
  for (let i = signal.length - SIZE; i < signal.length; i++) squares += signal[i] ** 2;
  return {
    aliasing: 10 * Math.log10(other / harmonics),
    spur: 10 * Math.log10(worst / fundamentalPeak),
    highest,
    rms: Math.sqrt(squares / SIZE),
  };
};

// the phase of the tone at `frequency` over SIZE samples from `from` (time of the absolute sample)
const tonePhase = (signal: Float32Array, from: number, frequency: number, rate: number) => {
  const window = kaiser(SIZE);
  let re = 0;
  let im = 0;
  for (let i = 0; i < SIZE; i++) {
    const phase = (2 * Math.PI * frequency * (from + i)) / rate;
    re += signal[from + i] * window[i] * Math.cos(phase);
    im -= signal[from + i] * window[i] * Math.sin(phase);
  }
  return Math.atan2(im, re);
};

// cents off `frequency` (the float32 of the param): the drift of the phase of the fundamental between the
// start and the end of the render
const pitchError = (signal: Float32Array, frequency: number, rate: number) => {
  const nominal = Math.fround(frequency);
  const from = LEAD;
  const to = signal.length - SIZE;
  let drift = tonePhase(signal, to, nominal, rate) - tonePhase(signal, from, nominal, rate);
  drift -= 2 * Math.PI * Math.round(drift / (2 * Math.PI));
  const actual = nominal + (drift * rate) / (2 * Math.PI * (to - from));
  return 1200 * Math.log2(actual / nominal);
};

const maxStep = (signal: Float32Array, from = 1) => {
  let max = 0;
  for (let i = Math.max(1, from); i < signal.length; i++)
    max = Math.max(max, Math.abs(signal[i] - signal[i - 1]));
  return max;
};

const toneAmplitude = (signal: Float32Array, frequency: number, rate: number, from = LEAD) => {
  let re = 0;
  let im = 0;
  let sum = 0;
  const n = signal.length - from;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const phase = (2 * Math.PI * frequency * i) / rate;
    re += signal[from + i] * w * Math.cos(phase);
    im -= signal[from + i] * w * Math.sin(phase);
    sum += w;
  }
  return (2 * Math.hypot(re, im)) / sum;
};

const db = (ratio: number) => 20 * Math.log10(ratio);

// --- benchmarks ---

// the frame of a table the sound is compared at: the saw, the middle frame of a real table
const frameOf = (frames: Frames) => Math.floor((frames.length - 1) / 2);
const positionOf = (frames: Frames) => (frames.length > 1 ? frameOf(frames) / (frames.length - 1) : 0);

const sound = async ({ rate, name, pitches }: { rate: number; name: string; pitches: number[] }) => {
  const frames = await table(name);
  const levels = buildLevels(frames);
  const k = frameOf(frames);
  const results = [];
  for (const frequency of pitches) {
    const native = analyze(
      await nativeRender(rate, SIZE + LEAD, frames[k], frequency),
      frequency,
      rate,
      frames[k]
    );
    const [left] = await oursRender(
      rate,
      SIZE + LEAD,
      { a: levels },
      { params: { frequency, position1: positionOf(frames) } }
    );
    const ours = analyze(left, frequency, rate, frames[k]);
    results.push({ frequency, native, ours, level: db(ours.rms / native.rms) });
  }
  return results;
};

const pitch = async ({ rate, pitches }: { rate: number; pitches: number[] }) => {
  const frames = await table('saw');
  const levels = buildLevels(frames);
  const length = 10 * rate;
  const results = [];
  for (const frequency of pitches) {
    const native = pitchError(await nativeRender(rate, length, frames[0], frequency), frequency, rate);
    const [left] = await oursRender(rate, length, { a: levels }, { params: { frequency } });
    results.push({ frequency, native, ours: pitchError(left, frequency, rate) });
  }
  return results;
};

// a real table: frame k at k / (N - 1) is the frame alone; the morph and a glide have no steps; a new
// version of the table during a note
const continuity = async ({ rate, name }: { rate: number; name: string }) => {
  const frames = await table(name);
  const levels = buildLevels(frames);
  const k = frameOf(frames);
  const length = rate;
  const [atPosition] = await oursRender(
    rate,
    8192,
    { a: levels },
    { params: { frequency: 220, position1: Math.fround(k / (frames.length - 1)) } }
  );
  const [alone] = await oursRender(
    rate,
    8192,
    { a: buildLevels([frames[k]]) },
    { params: { frequency: 220 } }
  );
  let positionError = 0;
  for (let i = 0; i < 8192; i++) positionError = Math.max(positionError, Math.abs(atPosition[i] - alone[i]));

  const [morph] = await oursRender(rate, length, { a: levels }, { params: { frequency: 220 } }, (voice) => {
    const position = voice.parameters.get('position1') as AudioParam;
    position.setValueAtTime(0, 0);
    position.linearRampToValueAtTime(1, 1);
  });
  let stationary = 0;
  for (let f = 0; f < frames.length; f++)
    stationary = Math.max(
      stationary,
      maxStep(
        dspRender(rate, levels, 2048, {
          frequency: 220,
          position1: frames.length > 1 ? f / (frames.length - 1) : 0,
        })
      )
    );

  const saw = buildLevels(await table('saw'));
  const [glide] = await oursRender(rate, 2 * rate, { a: saw }, { params: { frequency: 55 } }, (voice) => {
    const frequency = voice.parameters.get('frequency') as AudioParam;
    frequency.setValueAtTime(55, 0);
    frequency.exponentialRampToValueAtTime(7000, 2);
  });
  let glideStationary = 0;
  for (let i = 0; i < 64; i++)
    glideStationary = Math.max(
      glideStationary,
      maxStep(dspRender(rate, saw, 2048, { frequency: 55 * (7000 / 55) ** (i / 63) }))
    );

  return {
    positionError,
    morph: maxStep(morph) / stationary,
    glide: maxStep(glide) / glideStationary,
  };
};

// a new version of the table at 0.25 s of a note: no step, the new table from 10 ms on
const tableSwitch = async ({ rate, name }: { rate: number; name: string }) => {
  const from = buildLevels(await table('saw'));
  const frames = await table(name);
  const to = buildLevels(frames);
  const length = rate / 2;
  const at = Math.round((0.25 * rate) / BLOCK) * BLOCK;
  const ctx = new OfflineAudioContext(2, length, rate);
  const store = await createStore(ctx, { a: from });
  const voice = createVoice(ctx, { params: { frequency: 220 } });
  voice.connect(ctx.destination);
  ctx.suspend(at / rate).then(() => storeTable(store, 'a', 2, to).then(() => ctx.resume()));
  const switched = (await ctx.startRendering()).getChannelData(0);
  const [reference] = await oursRender(rate, length, { a: to }, { params: { frequency: 220 } });
  const done = at + Math.ceil(0.01 * rate) + BLOCK;
  let after = 0;
  for (let i = done; i < length; i++) after = Math.max(after, Math.abs(switched[i] - reference[i]));
  const stationary = Math.max(maxStep(dspRender(rate, from, 4096, { frequency: 220 })), maxStep(reference));
  return { step: maxStep(switched) / stationary, afterCrossfade: after };
};

// u3 (spread 2400 cents: an octave below, the note, an octave above) and u8 (1400 cents): the amplitude of
// each voice in each channel
const stereo = async ({ rate }: { rate: number }) => {
  const sine = buildLevels([
    Array.from({ length: WAVE_SIZE }, (_, n) => Math.sin((2 * Math.PI * n) / WAVE_SIZE)),
  ]);
  const [l3, r3] = await oursRender(
    rate,
    rate,
    { a: sine },
    { unison: 3, params: { frequency: 400, spread1: 2400 } }
  );
  const u3 = [200, 400, 800].map((f) => [toneAmplitude(l3, f, rate), toneAmplitude(r3, f, rate)]);
  const [l8, r8] = await oursRender(
    rate,
    rate,
    { a: sine },
    { unison: 8, params: { frequency: 400, spread1: 1400 } }
  );
  const u8 = Array.from({ length: 8 }, (_, j) => {
    const f = 400 * 2 ** (((j / 7 - 0.5) * 1400) / 1200);
    return [toneAmplitude(l8, f, rate), toneAmplitude(r8, f, rate)];
  });
  return { u3, u8 };
};

// many notes of a saw at 220 Hz, detune 5, Phase rand 1: the power and the peak of the first 100 ms against u1
const unisonLevel = async ({ rate, notes }: { rate: number; notes: number }) => {
  const levels = buildLevels(await table('saw'));
  const measure = async (unison: number) => {
    const gap = 0.15;
    const ctx = new OfflineAudioContext(2, Math.ceil((notes * gap + 0.2) * rate), rate);
    await createStore(ctx, { a: levels });
    // referenced until the end of the render: WebKit collects the nodes JS no longer holds
    const voices = Array.from({ length: notes }, (_, i) =>
      createVoice(ctx, {
        unison,
        phaseRand: 1,
        params: { frequency: 220, spread1: 5 },
        start: i * gap,
        stop: i * gap + 0.1,
      })
    );
    voices.forEach((voice) => voice.connect(ctx.destination));
    const buffer = await ctx.startRendering();
    voices.length = 0;
    const [left, right] = [buffer.getChannelData(0), buffer.getChannelData(1)];
    let power = 0;
    let peak = 0;
    for (let i = 0; i < notes; i++) {
      const from = Math.ceil(i * gap * rate);
      const to = from + Math.floor(0.1 * rate);
      let squares = 0;
      let max = 0;
      for (let n = from; n < to; n++) {
        squares += left[n] ** 2 + right[n] ** 2;
        max = Math.max(max, Math.abs(left[n]), Math.abs(right[n]));
      }
      power += squares / (2 * (to - from));
      peak += max;
    }
    return { rms: Math.sqrt(power / notes), peak: peak / notes };
  };
  const one = await measure(1);
  const results = [];
  for (const unison of [2, 3, 4, 8]) {
    const many = await measure(unison);
    results.push({ unison, rms: db(many.rms / one.rms), peak: db(many.peak / one.peak) });
  }
  return results;
};

// --- cpu ---

// buses: no modulation, every param of the voices connected to a silent mod bus (as in the synth);
// env-sustain: ENV 2 on Wave, Detune and Gain of both oscillators, on its sustain from the note on (the
// voices play their mix tables); env-moving: the same envelope decaying for the whole render
// lfo-wdg: an LFO into the same params as the envelopes (the direct path they are compared with);
// still-sustain: no route, the knobs where ENV 2 holds them on its sustain (the same sound as env-sustain)
type Modulation =
  | 'none'
  | 'buses'
  | 'position'
  | 'detune'
  | 'env-sustain'
  | 'env-moving'
  | 'lfo-wdg'
  | 'still-sustain';

// 8 voices of a chord, both oscillators with unison 4: 64 oscillators. Native: the graph the synth had,
// per oscillator 4 OscillatorNodes in pairs into a merger, its gain, the envelope of the voice; ours: one
// worklet node per voice, its envelope inside. Modulation: an LFO into the position of every voice (ours
// only, native has no morph) or into the detune of every oscillator, or ENV 2 of the voices (ours only)
const cpu = async ({
  rate,
  name,
  modulation,
  seconds,
  voices = 8,
  unison = 4,
}: {
  rate: number;
  name: string;
  modulation: Modulation;
  seconds: number;
  voices?: number;
  unison?: number;
}) => {
  const frames = await table(name);
  const levels = buildLevels(frames);
  const notes = Array.from({ length: voices }, (_, i) => 110 * 2 ** ((i * 4) / 12));
  const spread = 20;

  const native = async () => {
    const ctx = new OfflineAudioContext(2, seconds * rate, rate);
    const [real, imag] = wave.realWithImag(frames[frameOf(frames)]);
    const periodic = ctx.createPeriodicWave(real, imag, { disableNormalization: true });
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5;
    depth.gain.value = 30;
    lfo.connect(depth);
    lfo.start(0);
    for (const note of notes) {
      const envelope = ctx.createGain();
      envelope.connect(ctx.destination);
      for (let o = 0; o < 2; o++) {
        const gain = ctx.createGain();
        gain.gain.value = 0.1;
        gain.connect(envelope);
        const merger = ctx.createChannelMerger(2);
        merger.connect(gain);
        for (let j = 0; j < unison; j++) {
          const osc = ctx.createOscillator();
          osc.setPeriodicWave(periodic);
          osc.frequency.value = note * (o + 1);
          osc.detune.value = -spread / 2 + (spread * j) / (unison - 1);
          if (modulation === 'detune') depth.connect(osc.detune);
          osc.connect(merger, 0, j % 2);
          osc.start(0);
        }
      }
    }
    const start = performance.now();
    await ctx.startRendering();
    return performance.now() - start;
  };

  const ours = async () => {
    const ctx = new OfflineAudioContext(2, seconds * rate, rate);
    await createStore(ctx, { a: levels });
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = modulation === 'position' ? 0.25 : 5;
    depth.gain.value = modulation === 'position' ? 0.5 : 30;
    lfo.connect(depth);
    lfo.start(0);
    // the mod buses of both oscillators, nothing plays into them
    const buses = [
      'position1',
      'detune1',
      'spread1',
      'gain1',
      'position2',
      'detune2',
      'spread2',
      'gain2',
    ].map((name) => [name, ctx.createGain()] as const);
    for (const note of notes) {
      // on the sustain (0.5) ENV 2 adds a quarter of the table, 25 cents and -0.025
      const still = modulation === 'still-sustain';
      const position = modulation === 'position' ? 0.5 : positionOf(frames) + (still ? 0.25 : 0);
      const [voiceSpread, voiceGain] = still ? [spread + 25, 0.075] : [spread, 0.1];
      const env2 =
        modulation === 'env-moving'
          ? { attack: 0, hold: 0, decay: seconds, sustain: 0, release: 0 }
          : { attack: 0, hold: 0, decay: 0, sustain: 0.5, release: 0 };
      const routed = modulation === 'env-sustain' || modulation === 'env-moving';
      const routes = [1, 2].flatMap((osc) => [
        { env: 1, param: `position${osc}`, amount: 0.5, min: 0, max: 1 },
        { env: 1, param: `spread${osc}`, amount: 50, min: 0, max: 100 },
        { env: 1, param: `gain${osc}`, amount: -0.05, min: 0, max: 1 },
      ]);
      const voice = createVoice(
        ctx,
        {
          unison,
          params: { frequency: note, spread1: voiceSpread, gain1: voiceGain, position1: position },
          ...(routed && { envelopes: [ENVELOPES[0], env2, ENVELOPES[2]], routes }),
        },
        { unison, params: { detune2: 1200, spread2: voiceSpread, gain2: voiceGain, position2: position } }
      );
      if (modulation === 'position')
        ['position1', 'position2'].forEach((p) => depth.connect(voice.parameters.get(p) as AudioParam));
      if (modulation === 'detune')
        ['detune1', 'detune2'].forEach((p) => depth.connect(voice.parameters.get(p) as AudioParam));
      if (modulation === 'lfo-wdg')
        (
          [
            ['position', 0.25],
            ['spread', 25],
            ['gain', 0.05],
          ] as const
        ).forEach(([param, amount]) => {
          const scaled = ctx.createGain();
          scaled.gain.value = amount;
          lfo.connect(scaled);
          [1, 2].forEach((osc) => scaled.connect(voice.parameters.get(`${param}${osc}`) as AudioParam));
        });
      if (modulation === 'buses')
        buses.forEach(([name, bus]) => bus.connect(voice.parameters.get(name) as AudioParam));
      voice.connect(ctx.destination);
    }
    const start = performance.now();
    await ctx.startRendering();
    return performance.now() - start;
  };

  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const nativeTimes: number[] = [];
  const ourTimes: number[] = [];
  // warm up, then alternate
  await native();
  await ours();
  for (let i = 0; i < 5; i++) {
    nativeTimes.push(await native());
    ourTimes.push(await ours());
  }
  // native without modulation when ours modulates the position (it has nothing to modulate)
  return {
    native: median(nativeTimes),
    ours: median(ourTimes),
    ratio: median(ourTimes) / median(nativeTimes),
  };
};

// the way the synth delivers a table: frames → worker (wavetable-worker.js) → MessageChannel → the store
// processor; the ms from posting the frames to the ack of the store, the longest the main thread was
// blocked meanwhile (a 5 ms interval), and a voice playing the delivered table
const delivery = async ({ rate, name }: { rate: number; name: string }) => {
  const frames = await table(name);
  const ctx = new OfflineAudioContext(2, 4096, rate);
  await ctx.audioWorklet.addModule(WORKLET_URL);
  const store = new AudioWorkletNode(ctx, STORE_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1 });
  const worker = new Worker('wavetable-worker.js');
  const channel = new MessageChannel();
  store.port.postMessage({ port: channel.port1 }, [channel.port1]);
  worker.postMessage({ port: channel.port2 }, [channel.port2]);
  let longest = 0;
  let last = performance.now();
  const ticks = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 5);
  const start = performance.now();
  const stored = new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('the store did not answer')), 10000);
    store.port.onmessage = ({ data }) => {
      if (data.stored !== 'a') return;
      clearTimeout(timeout);
      resolve(performance.now() - start);
    };
  });
  const copies = frames.map((frame) => Float32Array.from(frame));
  worker.postMessage(
    { table: 'a', version: 1, frames: copies },
    copies.map(({ buffer }) => buffer)
  );
  const ms = await stored;
  clearInterval(ticks);
  const voice = createVoice(ctx, { params: { frequency: 220, position1: positionOf(frames) } });
  voice.connect(ctx.destination);
  const left = (await ctx.startRendering()).getChannelData(0);
  const [reference] = await oursRender(
    rate,
    4096,
    { a: buildLevels(frames) },
    { params: { frequency: 220, position1: positionOf(frames) } }
  );
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference = Math.max(difference, Math.abs(left[i] - reference[i]));
  worker.terminate();
  return { frames: frames.length, ms, blocked: longest, difference };
};

const build = async ({ name }: { name: string }) => {
  const frames = await table(name);
  buildLevels(frames.slice(0, 4));
  const start = performance.now();
  const levels = buildLevels(frames);
  const ms = performance.now() - start;
  return { frames: frames.length, ms, bytes: levels.data.byteLength };
};

// the bandpass of the delay (two BiquadFilterNodes, as its lines) when ENV 2 moves its Freq and Q: still, by
// a-rate automation (the browser may work the coefficients out every sample) and by k-rate (once per block).
// The envelope of a note every 0.5 s: up in 50 ms, down in 300 ms, exponential ramps as fx-automation.ts
// schedules them; a saw of 110 Hz into them for 10 s
type BiquadMode = 'still' | 'a-rate' | 'k-rate';
const biquadAutomation = async ({ rate, seconds }: { rate: number; seconds: number }) => {
  const render = async (mode: BiquadMode) => {
    const ctx = new OfflineAudioContext(2, seconds * rate, rate);
    const source = ctx.createOscillator();
    source.type = 'sawtooth';
    source.frequency.value = 110;
    const merger = ctx.createChannelMerger(2);
    [0, 1].forEach((channel) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1000;
      filter.Q.value = 1;
      if (mode === 'k-rate') {
        filter.frequency.automationRate = 'k-rate';
        filter.Q.automationRate = 'k-rate';
      }
      if (mode !== 'still')
        for (let start = 0; start < seconds; start += 0.5) {
          filter.frequency.setValueAtTime(1000, start);
          filter.frequency.exponentialRampToValueAtTime(4000, start + 0.05);
          filter.frequency.exponentialRampToValueAtTime(1500, start + 0.35);
          filter.Q.setValueAtTime(1, start);
          filter.Q.exponentialRampToValueAtTime(2.5, start + 0.05);
          filter.Q.exponentialRampToValueAtTime(1.3, start + 0.35);
        }
      source.connect(filter).connect(merger, 0, channel);
    });
    merger.connect(ctx.destination);
    source.start(0);
    const start = performance.now();
    await ctx.startRendering();
    return performance.now() - start;
  };
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const modes: BiquadMode[] = ['still', 'a-rate', 'k-rate'];
  const times: Record<BiquadMode, number[]> = { still: [], 'a-rate': [], 'k-rate': [] };
  for (const mode of modes) await render(mode);
  for (let i = 0; i < 5; i++) for (const mode of modes) times[mode].push(await render(mode));
  return { still: median(times.still), aRate: median(times['a-rate']), kRate: median(times['k-rate']) };
};

Object.assign(window, {
  bench: {
    sound,
    pitch,
    continuity,
    tableSwitch,
    stereo,
    unisonLevel,
    cpu,
    build,
    delivery,
    biquadAutomation,
  },
});
