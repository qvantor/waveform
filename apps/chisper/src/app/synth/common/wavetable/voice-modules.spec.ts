import { oscScope, storeWith, VOICE_DEFAULTS } from '../../../../test-utils/voice-dsp';
import type { EnvelopeParams } from '../envelope/envelope-curve';
import { buildNoiseLevels } from './noise-levels';
import type { VoiceOptions } from './voice-options';
import { MODULE_IDS, ROUTE_IDS, routeParam, VOICE_MODULES } from './voice-modules';
import { buildLevels } from './wavetable-mipmap';
import { VoiceParam } from './wavetable-osc-params';
import { createVoiceSharedWasm, createVoiceWasm } from './wavetable-osc-wasm';

// the modules of a voice whose knobs the routes move: the table of the facade against the one of the core
// (targets.rs, osc_targets), the ids of their knobs, and the sources of a note off for it

const BLOCK = 128;
const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const SINE = Array.from({ length: 2048 }, (_, n) => Math.sin((2 * Math.PI * n) / 2048));
const noiseLevels = (hz: number) =>
  buildNoiseLevels(
    [Float32Array.from({ length: 4410 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / 44100))],
    44100
  );

describe('the modules of a voice', () => {
  it('are those of the core, in its order: the id of every route is the knob the core has there', () => {
    const scope = oscScope();
    const count = scope.exports.osc_targets();
    const command = scope.command();
    expect(command[0]).toBe(VOICE_MODULES.length);
    // the names of the knobs, in the order of the ids of the core: the instances of each of its modules
    const names = VOICE_MODULES.flatMap(({ module, knobs, name }, m) => {
      expect({ module, instances: command[1 + 2 * m], knobs: command[2 + 2 * m] }).toEqual({
        module,
        instances: VOICE_MODULES[m].instances,
        knobs: knobs.length,
      });
      expect(MODULE_IDS[module]).toBe(m);
      return Array.from({ length: command[1 + 2 * m] }, (_, instance) =>
        knobs.map((knob: string) => name(knob, instance))
      ).flat();
    });
    const ids = Object.fromEntries(names.map((route, id) => [route, id]));
    expect(ROUTE_IDS).toEqual(ids);
    expect(Object.keys(ROUTE_IDS)).toHaveLength(count);
  });

  // a new module goes last: these never move (inserting one before them fails here)
  it('keeps the ids of the knobs of every module', () => {
    expect(ROUTE_IDS).toEqual({
      position1: 0,
      spread1: 1,
      gain1: 2,
      pitch1: 3,
      fine1: 4,
      blend1: 5,
      position2: 6,
      spread2: 7,
      gain2: 8,
      pitch2: 9,
      fine2: 10,
      blend2: 11,
      cutoff: 12,
      resonance: 13,
      gain: 14,
      'noise.level': 15,
      'noise.pan': 16,
      'noise.pitch': 17,
      'noise.fine': 18,
      ...Object.fromEntries(
        [1, 2, 3, 4].flatMap((lfo) =>
          ['rate', 'delay', 'rise', 'smooth', 'phase'].map((knob, k) => [
            `lfo${lfo}.${knob}`,
            19 + 5 * (lfo - 1) + k,
          ])
        )
      ),
    });
    expect(routeParam('osc', 1, 'blend')).toBe('blend2');
    expect(routeParam('filter', 0, 'cutoff')).toBe('cutoff');
    expect(routeParam('noise', 0, 'pan')).toBe('noise.pan');
    expect(routeParam('lfo', 3, 'phase')).toBe('lfo4.phase');
  });

  describe('a source off for the note', () => {
    const params = Object.fromEntries(
      Object.entries({ ...VOICE_DEFAULTS, spread1: 10, spread2: 10 }).map(([param, value]) => [
        param,
        Float32Array.of(value),
      ])
    ) as Record<VoiceParam, Float32Array>;
    const options = (all: boolean): VoiceOptions => ({
      osc: [
        { table: 'a', unison: 3, phase: 0, phaseRand: 1 },
        all ? { table: 'b', unison: 2, phase: 0, phaseRand: 1 } : null,
      ],
      noise: all
        ? { sample: 'n', loop: true, keytrack: false, start: 0, rand: 0, level: 1, pan: 0, cents: 0 }
        : null,
      start: 0,
      envelopes: [FLAT],
      envStart: 0,
      phrase: 1,
      routes: [],
      filter: null,
    });

    // a voice of the options of `all` over `blocks`, the tables and the sample of the noise replaced meanwhile:
    // its unison voices and their samples, the versions held while it plays
    const play = (all: boolean, blocks: number) => {
      const { store } = storeWith({ a: [SINE], b: [SINE] });
      store.set('n', 1, noiseLevels(300));
      const shared = createVoiceSharedWasm(oscScope());
      const voice = createVoiceWasm(oscScope(), 48000, options(all), store, () => 0.5, shared);
      const [outL, outR] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      for (let block = 0; block < blocks; block++) voice.process(block * BLOCK, params, outL, outR);
      store.set('b', 2, buildLevels([SINE.map((v) => -v)]));
      store.set('n', 2, noiseLevels(400));
      const { unison, mixSamples, directSamples } = shared.stats();
      const { versions } = store.stats();
      voice.end();
      store.free();
      shared.free();
      return { unison, samples: mixSamples + directSamples, versions };
    };

    it('plays nothing of it and holds none of its versions', () => {
      // osc 2 and the noise off: osc 1 alone (3 voices); the old versions of their table and sample go
      expect(play(false, 4)).toEqual({ unison: 3, samples: 3 * 4 * BLOCK, versions: 3 });
      // on: osc 1, osc 2 (5 voices), the noise; it holds the versions it plays
      expect(play(true, 4)).toEqual({ unison: 5, samples: 5 * 4 * BLOCK, versions: 5 });
    });
  });
});
