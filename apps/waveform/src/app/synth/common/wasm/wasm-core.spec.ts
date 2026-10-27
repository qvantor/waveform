import { wasmCore } from '../../../../test-utils/wasm';
import { createDistortionWasm, DistortionExports } from '../../fx/effects/distortion-wasm';
import { TONE_OPEN } from '../../fx/effects/distortion-params';
import { buildLevels } from '../wavetable/wavetable-mipmap';
import type { VoiceOptions } from '../wavetable/voice-options';
import { VOICE_PARAMETERS, VoiceParam } from '../wavetable/wavetable-osc-params';
import {
  createOscScope,
  createTableStoreWasm,
  createVoiceSharedWasm,
  createVoiceWasm,
  OscExports,
} from '../wavetable/wavetable-osc-wasm';

// a trap of a core (an allocation that failed, an index out of its bounds) leaves its stack pointer where the call
// had moved it: every call of a core puts it back (instantiateCore, the calls of a block where they are made), so
// failed calls never use up the stack of 64 KiB (about 70 failed note ons did) and hold nothing of the store

const RATE = 48000;
const FLAT = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const SINE = Array.from({ length: 2048 }, (_, n) => Math.sin((2 * Math.PI * n) / 2048));

const options = (routes = 0): VoiceOptions => ({
  osc: [{ table: 'a', unison: 2, phase: 0, phaseRand: 0 }, null],
  start: 0,
  envelopes: [FLAT, FLAT, FLAT],
  envStart: 0,
  phrase: 1,
  // (more routes than the command buffer of the core holds: it reads past its end, a panic, so a trap)
  routes: Array.from({ length: routes }, () => ({ source: 1, param: 'gain1', amount: 0.5, min: 0, max: 1 })),
  filter: null,
});

const params = () =>
  Object.fromEntries(
    VOICE_PARAMETERS.map(({ name, defaultValue }) => [name, Float32Array.of(defaultValue)])
  ) as Record<VoiceParam, Float32Array>;

const createOsc = () => {
  const scope = createOscScope(wasmCore<OscExports>('wavetable-osc'));
  const store = createTableStoreWasm(scope);
  const shared = createVoiceSharedWasm(scope);
  store.set('a', 1, buildLevels([SINE]));
  const voice = (routes = 0) => createVoiceWasm(scope, RATE, options(routes), store, Math.random, shared);
  return { scope, store, shared, voice, stack: scope.exports.__stack_pointer };
};

describe('the calls of a core put its stack pointer back when they trap', () => {
  it('200 note ons that trap: each throws, the stack stays, a note after them plays, no version is held', () => {
    const { store, voice, stack } = createOsc();
    const top = stack.value;
    const before = store.stats();
    for (let i = 0; i < 200; i++) {
      expect(() => voice(1000)).toThrow(WebAssembly.RuntimeError);
      expect(stack.value).toBe(top);
    }
    expect(store.stats()).toEqual(before);
    const played = voice();
    const [outL, outR] = [new Float32Array(128), new Float32Array(128)];
    for (let block = 0; block < 4; block++) played.process(block * 128, params(), outL, outR);
    expect(Math.max(...outL.map(Math.abs))).toBeGreaterThan(0.1);
    // the version goes once the note and the store let it go
    played.end();
    store.remove('a');
    expect(store.stats()).toMatchObject({ tables: 0, versions: 0 });
    expect(stack.value).toBe(top);
  });

  it('a call whose frame is out of the memory traps in its prologue: the stack pointer is the one before it', () => {
    const { store, voice, stack } = createOsc();
    const top = stack.value;
    // (near 0: the frame of the call goes below the memory)
    stack.value = 16;
    expect(() => voice()).toThrow(WebAssembly.RuntimeError);
    expect(stack.value).toBe(16);
    expect(() =>
      store.begin('b', 1, { frames: 1, harmonics: [1], lengths: [8], offsets: [0], length: 11 })
    ).toThrow(WebAssembly.RuntimeError);
    expect(stack.value).toBe(16);
    stack.value = top;
  });

  it('a block that traps (guarded where it is called, no closure per block) puts it back too', () => {
    const { voice, stack } = createOsc();
    const top = stack.value;
    const played = voice();
    const [outL, outR] = [new Float32Array(128), new Float32Array(128)];
    stack.value = 16;
    expect(() => played.process(0, params(), outL, outR)).toThrow(WebAssembly.RuntimeError);
    expect(stack.value).toBe(16);
    stack.value = top;
    // the processor ends a voice that threw: its versions go back
    expect(() => played.end()).not.toThrow();
    expect(played.ended).toBe(true);
  });

  it('a stereo core: its constructor and its blocks', () => {
    const core = wasmCore<DistortionExports>('distortion');
    const { __stack_pointer: stack } = core;
    const top = stack.value;
    const create = () =>
      createDistortionWasm(core, RATE, { params: { mode: 0, drive: 8, tone: TONE_OPEN, level: 0 } });
    stack.value = 16;
    expect(create).toThrow(WebAssembly.RuntimeError);
    expect(stack.value).toBe(16);
    stack.value = top;
    const distortion = create();
    const block = () => Float32Array.from({ length: 128 }, (_, n) => Math.sin(n / 5));
    stack.value = 16;
    expect(() => distortion.process(block(), block(), block(), block())).toThrow(WebAssembly.RuntimeError);
    expect(stack.value).toBe(16);
    stack.value = top;
    expect(() => distortion.process(block(), block(), block(), block())).not.toThrow();
    distortion.free();
    expect(stack.value).toBe(top);
  });
});
