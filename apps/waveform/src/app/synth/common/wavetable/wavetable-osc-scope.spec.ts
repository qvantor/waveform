// first: the Math of JS as jsmath (test-utils/js-math.ts): the formulas of the spec worked out here as the core does
import '../../../../test-utils/js-math';
import { BLOCK, oscScope, seeded, storeWith } from '../../../../test-utils/voice-dsp';
import { expectSameBits } from '../../../../test-utils/parity';
import type { EnvelopeParams } from '../envelope/envelope-curve';
import type { VoiceEvent, VoiceOptions, VoiceOscOptions } from './voice-options';
import { HELD_AGAIN_GATE, RELEASE_GATE, VOICE_PARAMETERS, VoiceParam } from './wavetable-osc-params';
import { createVoiceScopeWasm, createVoiceSharedWasm, VOICE_PARAM_ORDER } from './wavetable-osc-wasm';

// the voices of one node in the core (scope.rs): their params from the events of the main thread (a timeline
// per param, as an AudioParam has them: the formulas of the spec), rendered in the order they were made into their
// f32 sum; a voice that traps ends alone; the starts and the ends of a block in one report

const RATE = 48000;
const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const ENV: EnvelopeParams = { attack: 0.01, hold: 0, decay: 0.05, sustain: 0.6, release: 0.02 };
const SAW = Array.from({ length: 2048 }, (_, n) => {
  let sum = 0;
  for (let k = 1; k <= 300; k++) sum += Math.sin((2 * Math.PI * k * n) / 2048) / k;
  return sum;
});
const { store } = storeWith({ saw: [SAW, SAW.map((v) => -0.5 * v)] });

const osc = (config: Partial<VoiceOscOptions> = {}): VoiceOscOptions => ({
  table: 'saw',
  unison: 3,
  phase: 0.25,
  phaseRand: 0,
  ...config,
});
const note = (options: Partial<VoiceOptions> = {}): VoiceOptions => ({
  osc: [osc(), null],
  start: 0,
  envelopes: [FLAT, ENV, FLAT],
  envStart: 0,
  phrase: 0,
  routes: [],
  filter: null,
  ...options,
});

// a node of its own: its shared (the mix budget of its blocks is its own)
const node = (onError?: (error: unknown) => void) => {
  const scope = oscScope();
  const shared = createVoiceSharedWasm(scope);
  const voices = createVoiceScopeWasm(scope, RATE, store, shared, seeded(1), onError);
  voices.tap(true);
  return { voices, shared };
};

const render = (voices: ReturnType<typeof node>['voices'], frame: number) => {
  const [left, right] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  voices.process(frame, left, right);
  return { left, right, taps: voices.taps(BLOCK), report: voices.reports() };
};

// more routes than the command buffer holds: the core reads past it, it traps
const TOO_MANY_ROUTES = Array.from({ length: 1000 }, () => ({
  env: 1,
  param: 'gain1',
  amount: 1,
  min: 0,
  max: 1,
}));

const DEFAULTS = Object.fromEntries(VOICE_PARAMETERS.map(({ name, defaultValue }) => [name, defaultValue]));

// the value of a param at `t` by the formulas of the spec, in f32
type Curve = (t: number) => number;

describe('the voices of one node', () => {
  it('works the params out from their events by the formulas of the spec, in f32', () => {
    // a portamento (a set, then exponential ramps), a knob that glides (a target, then a set), the octave
    // stepped (a set), the key released (a set of the gate)
    const glide: [number, number][] = [
      [300 / RATE, 300],
      [700 / RATE, 520],
      [1100 / RATE, 660],
    ];
    const t0 = 40 / RATE;
    const knob = 500 / RATE;
    const events: VoiceEvent[] = [
      { kind: 'set', voice: 1, param: 'frequency', value: Math.fround(220), time: t0 },
      ...glide.map(
        ([time, value]): VoiceEvent => ({ kind: 'ramp', voice: 1, param: 'frequency', value, time })
      ),
      { kind: 'cancel', voice: 1, param: 'gain1', time: knob },
      { kind: 'target', voice: 1, param: 'gain1', value: Math.fround(0.2), time: knob, constant: 0.0033 },
      { kind: 'set', voice: 1, param: 'gain1', value: Math.fround(0.2), time: knob + 0.0198 },
      { kind: 'set', voice: 1, param: 'detune1', value: -1200, time: 900.5 / RATE },
      { kind: 'set', voice: 1, param: 'gate', value: Math.fround(RELEASE_GATE + 0.031), time: 1500 / RATE },
    ];
    const f32 = Math.fround;
    const curves: Partial<Record<VoiceParam, Curve>> = {
      frequency: (t) => {
        if (t < t0) return f32(440);
        let [from, start] = [f32(220), t0];
        for (const [time, value] of glide) {
          if (t < time) return f32(from * (value / from) ** ((t - start) / (time - start)));
          [from, start] = [value, time];
        }
        return from;
      },
      // from 0.5, the value before it, to the knob in f32
      gain1: (t) =>
        t < knob
          ? 0.5
          : t < knob + 0.0198
          ? f32(f32(0.2) + (0.5 - f32(0.2)) * Math.exp(-(t - knob) / 0.0033))
          : f32(0.2),
      detune1: (t) => (t < 900.5 / RATE ? 0 : -1200),
      gate: (t) => (t < 1500 / RATE ? 1 : f32(RELEASE_GATE + 0.031)),
    };
    const options = note({ envelopes: [ENV, FLAT, FLAT] });
    const evented = node();
    evented.voices.apply([
      { kind: 'on', voice: 1, options, params: { frequency: 440, gain1: 0.5 } },
      ...events,
    ]);
    const direct = node();
    direct.voices.on(1, options, {});
    for (let block = 0; block < 20; block++) {
      const frame = block * BLOCK;
      const params = Object.fromEntries(
        VOICE_PARAM_ORDER.map((name) => {
          const curve = curves[name] ?? (() => f32(DEFAULTS[name]));
          return [name, Float32Array.from({ length: BLOCK }, (_, i) => curve((frame + i) / RATE))];
        })
      ) as Record<VoiceParam, Float32Array>;
      direct.voices.params(1, params, BLOCK);
      const [a, b] = [render(evented.voices, frame), render(direct.voices, frame)];
      expectSameBits('events', block, 'left', b.left, a.left);
      expectSameBits('events', block, 'right', b.right, a.right);
    }
    // the release of 20 ms from 31 ms after its start: it ended
    expect(evented.voices.stats().voices).toBe(0);
    evented.voices.free();
    direct.voices.free();
  });

  it('renders the voices in the order they were made, their sum in f32 in that order', () => {
    const { voices } = node();
    voices.apply(
      [5, 3, 9].map((id, i) => ({
        kind: 'on',
        voice: id,
        options: note({ osc: [osc({ unison: 2 + i }), null], phrase: id }),
        params: { frequency: 110 * (i + 2), spread1: 20 },
      }))
    );
    const { left, right, taps } = render(voices, 0);
    expect(taps.map(({ voice }) => voice)).toEqual([5, 3, 9]);
    const sum = (channel: 'left' | 'right') =>
      taps.reduce(
        (total, tap) => total.map((value, i) => Math.fround(value + tap[channel][i])),
        new Float32Array(BLOCK)
      );
    expectSameBits('order', 0, 'left', sum('left'), left);
    expectSameBits('order', 0, 'right', sum('right'), right);
    expect(taps.every(({ left }) => left.some((value) => value !== 0))).toBe(true);
    voices.free();
  });

  it('tells the starts and the ends of a block in one report: late, of mono, ended', () => {
    const { voices } = node();
    const events: VoiceEvent[] = [
      // on time: told only for mono
      { kind: 'on', voice: 1, options: note({ start: 10 / RATE, phrase: 1 }), params: {} },
      { kind: 'on', voice: 2, options: note({ start: 10 / RATE, phrase: 2, mono: true }), params: {} },
      // its node came late: told
      { kind: 'on', voice: 3, options: note({ start: 64 / RATE, phrase: 3 }), params: {} },
    ];
    voices.apply(events.slice(0, 2));
    expect(render(voices, 0).report).toEqual({ started: [[2, 10, 10]] });
    voices.apply(events.slice(2));
    expect(render(voices, 128).report).toEqual({ started: [[3, 128, 64]] });
    // a quiet block says nothing
    expect(render(voices, 256).report).toBeNull();
    // released at once (gate 0) and stolen (-1): both ended in the block they end in, one report
    voices.apply([
      { kind: 'set', voice: 1, param: 'gate', value: 0, time: 400 / RATE },
      { kind: 'set', voice: 3, param: 'gate', value: -1, time: 0 },
    ]);
    expect(render(voices, 384).report).toEqual({ ended: [1] });
    let report = null;
    for (let frame = 512; !report; frame += 128) report = render(voices, frame).report;
    expect(report).toEqual({ ended: [3] });
    expect(voices.stats().voices).toBe(1);
    voices.free();
  });

  it('takes the events of a voice that has ended as nothing, and a held gate again as a start again', () => {
    const { voices } = node();
    voices.apply([{ kind: 'on', voice: 1, options: note({ envelopes: [ENV, FLAT, FLAT] }), params: {} }]);
    voices.apply([{ kind: 'set', voice: 7, param: 'gate', value: 0, time: 0 }]);
    const held = Array.from({ length: 8 }, (_, block) => render(voices, block * BLOCK).left);
    expect(voices.stats().voices).toBe(1);
    // released, then held again at the other value before the release is over: the envelope starts again
    voices.apply([
      { kind: 'set', voice: 1, param: 'gate', value: Math.fround(RELEASE_GATE), time: 1024 / RATE },
      { kind: 'set', voice: 1, param: 'gate', value: HELD_AGAIN_GATE, time: 1100 / RATE },
    ]);
    const again = Array.from({ length: 20 }, (_, block) => render(voices, (8 + block) * BLOCK).left);
    expect(held[7].some((value) => value !== 0)).toBe(true);
    expect(again[19].some((value) => value !== 0)).toBe(true);
    expect(voices.stats()).toEqual({ voices: 1, events: 2 });
    voices.free();
  });

  it('ends a voice that traps alone: it is told ended, its versions given back, the others play on', () => {
    const errors: unknown[] = [];
    const { voices, shared } = node((error) => errors.push(error));
    const versions = store.stats().versions;
    voices.apply(
      [1, 2, 3].map((id) => ({
        kind: 'on',
        voice: id,
        options: note({ phrase: id }),
        params: { frequency: 100 * id, spread1: 10 },
      }))
    );
    render(voices, 0);
    // the params of voice 2 for blocks of 64: its block of 128 reads past them, it traps
    const short = Object.fromEntries(VOICE_PARAM_ORDER.map((name) => [name, new Float32Array(64)])) as Record<
      VoiceParam,
      Float32Array
    >;
    short.frequency.fill(200);
    voices.params(2, short, 64);
    const { left, taps, report } = render(voices, 128);
    expect(errors).toEqual([expect.any(WebAssembly.RuntimeError)]);
    expect(report).toEqual({ ended: [2] });
    expect(taps.map(({ voice }) => voice)).toEqual([1, 3]);
    // the sum is the others'
    expectSameBits(
      'trap',
      1,
      'left',
      taps[0].left.map((value, i) => Math.fround(value + taps[1].left[i])),
      left
    );
    expect(shared.stats()).toMatchObject({ voices: 2 });
    voices.free();
    expect(store.stats().versions).toBe(versions);
    expect(shared.stats()).toMatchObject({ voices: 0, unison: 0 });
  });

  it('tells a note on that traps ended', () => {
    const errors: unknown[] = [];
    const { voices } = node((error) => errors.push(error));
    voices.apply([
      { kind: 'on', voice: 1, options: note({ routes: TOO_MANY_ROUTES }), params: {} },
      { kind: 'on', voice: 2, options: note({ phrase: 2 }), params: {} },
    ]);
    expect(errors).toEqual([expect.any(WebAssembly.RuntimeError)]);
    expect(render(voices, 0)).toMatchObject({ report: { ended: [1] }, taps: [{ voice: 2 }] });
    voices.free();
  });

  it('loses only the call that traps or the event it can not read: the events after them are applied', () => {
    const errors: unknown[] = [];
    const { voices } = node((error) => errors.push(error));
    voices.apply([
      { kind: 'on', voice: 1, options: note(), params: {} },
      { kind: 'on', voice: 2, options: note({ phrase: 2 }), params: {} },
      // each voice traps apart
      { kind: 'routes', voices: [1, 2], routes: TOO_MANY_ROUTES },
      { kind: 'set', voice: 2, param: 'gate', value: 0, time: 0 },
      // options the facade can't write: told ended
      {
        kind: 'on',
        voice: 3,
        options: { ...note(), envelopes: undefined } as unknown as VoiceOptions,
        params: {},
      },
      { kind: 'on', voice: 4, options: note({ phrase: 4 }), params: {} },
    ]);
    expect(errors).toEqual([
      expect.any(WebAssembly.RuntimeError),
      expect.any(WebAssembly.RuntimeError),
      expect.any(TypeError),
    ]);
    expect(voices.stats()).toEqual({ voices: 3, events: 1 });
    // voice 2 renders its block, released where its gate dropped
    const { report, taps } = render(voices, 0);
    expect(report).toEqual({ ended: [2, 3] });
    expect(taps.map(({ voice }) => voice)).toEqual([1, 2, 4]);
    voices.free();
  });

  it('the pitch bend of the node at rest: the same bits as none', () => {
    const play = (events: VoiceEvent[]) => {
      const { voices } = node();
      voices.apply([
        { kind: 'on', voice: 1, options: note(), params: { frequency: 220, spread1: 15 } },
        ...events,
      ]);
      const blocks = Array.from({ length: 6 }, (_, block) => render(voices, block * BLOCK));
      voices.free();
      return blocks;
    };
    const none = play([]);
    play([{ kind: 'bend', cents: 0 }]).forEach(({ left, right }, block) => {
      expectSameBits('bend 0', block, 'left', none[block].left, left);
      expectSameBits('bend 0', block, 'right', none[block].right, right);
    });
  });

  it('bends a voice made after its glide as its detune bent, to the bit: one value, on its mix tables', () => {
    // the bend glides in 10 ms (480 samples): over at block 4
    const play = (bend: number, detune: number) => {
      const { voices, shared } = node();
      voices.apply([{ kind: 'bend', cents: bend }]);
      for (let block = 0; block < 4; block++) render(voices, block * BLOCK);
      const options = note({ osc: [osc(), osc({ unison: 2 })], start: (4 * BLOCK) / RATE });
      voices.apply([
        {
          kind: 'on',
          voice: 1,
          options,
          params: { frequency: 220, spread1: 15, spread2: 10, detune1: detune, detune2: detune - 1200 },
        },
      ]);
      const blocks = Array.from({ length: 8 }, (_, block) => render(voices, (block + 4) * BLOCK));
      const { mixSamples } = shared.stats();
      voices.free();
      return { blocks, mixSamples };
    };
    const bent = play(700, 0);
    const detuned = play(0, 700);
    bent.blocks.forEach(({ left, right }, block) => {
      expectSameBits('bent', block, 'left', detuned.blocks[block].left, left);
      expectSameBits('bent', block, 'right', detuned.blocks[block].right, right);
    });
    expect(bent.mixSamples).toBe(detuned.mixSamples);
    expect(bent.mixSamples).toBeGreaterThan(0);
  });

  it('takes an event of a param it has not as nothing', () => {
    const { voices } = node();
    voices.apply([
      { kind: 'on', voice: 1, options: note(), params: { frequency: 100 } },
      { kind: 'set', voice: 1, param: 'pitch' as VoiceParam, value: 200, time: 0 },
    ]);
    expect(voices.stats()).toEqual({ voices: 1, events: 0 });
    voices.free();
  });
});
