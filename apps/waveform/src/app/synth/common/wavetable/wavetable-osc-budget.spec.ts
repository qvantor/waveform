import { Note } from '@waveform/ui-kit';
import { getFq } from '../../services';
import { TABLE_THROTTLE } from '../modules/oscillator';
import { BLOCK, createVoiceScope, storeWith, VoiceParams } from '../../../../test-utils/voice-dsp';
import { buildLevels } from './wavetable-mipmap';
import {
  CROSSFADE,
  KILL_FADE,
  nativeTableLength,
  UPSAMPLER_TAPS,
  VoiceOscOptions,
  VoiceStats,
} from './voice-options';
import { WASM_MIX_BUDGET } from './wavetable-osc-wasm';

// the work of the voices on the audio thread as exact counts (it replaces the CPU scenes of the browser suite
// but the heavy patch, S5): the samples each unison voice plays from its mix table or directly from the
// levels, the mix builds, their multiply-adds and the blocks they take. The counts don't depend on the
// machine, the cycles each costs are measured by scripts/bench-perf (S5 in the browser, dsp.mjs in Node).
//
// The tables: 3 frames of a saw of 1023 harmonics (any 2048-sample frame has the levels of a full one) at
// position 0.5, frame 1 exactly: a held note reads one frame, as the heavy patch does (frame 128 of 256)

const SAW = Array.from({ length: 2048 }, (_, n) => {
  let sum = 0;
  for (let k = 1; k <= 1023; k++) sum += Math.sin((2 * Math.PI * k * n) / 2048) / k;
  return sum;
});
const FRAMES = [SAW, SAW.map((v) => 0.5 * v), SAW.map((v) => -v)];

// the chord and the oscillators of the heavy patch (scripts/bench-perf/scenes.mjs): 12 notes of 2 × 8 unison
// voices, osc2 an octave down
const CHORD = [
  [3, 'C'],
  [3, 'D'],
  [3, 'E'],
  [3, 'G'],
  [3, 'A'],
  [4, 'C'],
  [4, 'D'],
  [4, 'E'],
  [4, 'G'],
  [4, 'A'],
  [4, 'B'],
  [5, 'C'],
] as Note[];
const OSCS: VoiceOscOptions[] = [
  { table: 'a', unison: 8, phase: 0.5, phaseRand: 1 },
  { table: 'b', unison: 8, phase: 0.5, phaseRand: 1 },
];
const params = (note: Note): VoiceParams => ({
  frequency: getFq(note),
  position1: 0.5,
  position2: 0.5,
  spread1: 25,
  spread2: 35,
  detune2: -1200,
  gain1: 0.5,
  gain2: 0.5,
});
const UNISON = CHORD.length * 16;

// the counts of the Rust core (dsp/wavetable-osc) under its budget of mix builds (it builds twice as fast as the TS
// did: 1.8 times its budget, the longest block of an attack as long)
const core = { budget: WASM_MIX_BUDGET };
const coreStoreWith = (tables: Record<string, number[][]>) => storeWith(tables);
const coreScope = (rate: number, store: ReturnType<typeof coreStoreWith>['store']) =>
  createVoiceScope({ rate, store });

const chord = (rate: number, notes = CHORD, oscs = OSCS) => {
  const { store, freed } = coreStoreWith({ a: FRAMES, b: FRAMES });
  const scope = coreScope(rate, store);
  notes.forEach((note) => scope.add(oscs, params(note)));
  const run = (blocks: number) => Array.from({ length: blocks }, () => scope.block());
  return { store, freed, scope, run };
};

const total = (blocks: VoiceStats[], key: keyof VoiceStats) =>
  blocks.reduce((sum, block) => sum + block[key], 0);
const lastBuild = (blocks: VoiceStats[]) => blocks.reduce((last, block, i) => (block.builds ? i : last), -1);
// the blocks up to the one from which every voice plays its mix table, no build left
const settled = (blocks: VoiceStats[]) =>
  blocks.findIndex((_, i) =>
    blocks.slice(i).every((block) => block.directSamples === 0 && block.builds === 0)
  );

describe('the work of the voices', () => {
  // the multiply-adds of a mix (build_cost of the voice): its fill (4096 at 44.1 and 48 kHz) and each of
  // the 2 levels it reads, added as it is when as long, interpolated at 6 points a sample when shorter; one
  // frame. 12,288 = 3 · 4096 (both levels 4096 long: the low notes), 32,768 = 4096 + 4096 + 6 · 4096 (the
  // next is 2048 long), 53,248 = 4096 + 2 · 6 · 4096 (both shorter: the high notes). At 48 kHz 120 unison voices
  // cost 12,288, 32 cost 32,768 and 40 cost 53,248: 4,653,056 in all
  it.each([
    [44100, 5144576, 16],
    [48000, 4653056, 15],
  ])(
    'at %i Hz the heavy chord builds its 192 mix tables (%i multiply-adds) within the budget, the last in block %j',
    (rate, cost, lasts) => {
      const last = lasts;
      const { run } = chord(rate);
      const blocks = run(40);
      // the first block plays directly (the mixes are built in the second block of constant params)
      expect(blocks[0]).toMatchObject({ directSamples: UNISON * BLOCK, mixSamples: 0, builds: 0 });
      expect(total(blocks, 'builds')).toBe(UNISON);
      expect(total(blocks, 'buildCost')).toBe(cost);
      // a block builds until its next mix would go over the budget: 29 of the cheapest in one block
      const cheapest = Math.floor(core.budget / (3 * nativeTableLength(rate)));
      expect(cheapest).toBe(29);
      expect(blocks[1]).toMatchObject({ builds: cheapest, peakCost: cheapest * 3 * nativeTableLength(rate) });
      blocks.forEach((block) => expect(block.peakCost).toBeLessThanOrEqual(core.budget));
      expect(lastBuild(blocks) + 1).toBe(last);
      expect(last - 1).toBeGreaterThanOrEqual(Math.ceil(cost / core.budget));
      // then every unison voice plays its mix table, nothing directly
      blocks
        .slice(last)
        .forEach((block) => expect(block).toMatchObject({ directSamples: 0, mixSamples: UNISON * BLOCK }));
    }
  );

  it('at 96 kHz two mixes cost more than the budget: one build a block, the chord takes 192 blocks (F1)', () => {
    const { run } = chord(96000);
    const blocks = run(200);
    // 16384-sample mixes (nativeTableLength), both levels interpolated into them
    const each = (1 + 2 * UPSAMPLER_TAPS) * nativeTableLength(96000);
    expect(each).toBe(212992);
    // (the TS budget is under one of them)
    expect(2 * each).toBeGreaterThan(core.budget);
    expect(total(blocks, 'buildCost')).toBe(UNISON * each);
    blocks.slice(1, 193).forEach((block) => expect(block).toMatchObject({ builds: 1, peakCost: each }));
    expect(lastBuild(blocks) + 1).toBe(193);
  });

  it.each([
    [1, 1],
    [1, 8],
    [4, 8],
    [12, 2],
    [12, 8],
  ])(
    '%i held notes of 2 × %i unison voices play 128 samples a unison voice a block from their mixes',
    (notes, unison) => {
      const oscs = OSCS.map((osc) => ({ ...osc, unison }));
      const { run } = chord(48000, CHORD.slice(0, notes), oscs);
      const blocks = run(60);
      blocks
        .slice(settled(blocks))
        .forEach((block) =>
          expect(block).toMatchObject({ mixSamples: notes * 2 * unison * BLOCK, directSamples: 0, builds: 0 })
        );
      expect(settled(blocks)).toBeLessThan(30);
    }
  );

  it('a gliding pitch plays directly, its mixes are built in the second block after it settles', () => {
    const { store } = coreStoreWith({ a: FRAMES, b: FRAMES });
    const scope = coreScope(48000, store);
    // a portamento of 100 ms: 37.5 blocks
    const glide = 4800;
    scope.add([OSCS[0], null], {
      ...params([4, 'A'] as Note),
      frequency: (frame) => (frame < glide ? 220 + (220 * frame) / glide : 440),
    });
    const blocks = Array.from({ length: 50 }, () => scope.block());
    const constant = Math.ceil(glide / BLOCK);
    blocks
      .slice(0, constant + 1)
      .forEach((block) => expect(block).toMatchObject({ builds: 0, mixSamples: 0 }));
    expect(blocks.findIndex((block) => block.builds > 0)).toBe(constant + 1);
    // its 8 mixes over the next blocks: 6 of 53,248 multiply-adds a block (the levels of A4 are shorter than a
    // mix)
    expect(blocks[constant + 1].builds).toBe(Math.floor(core.budget / 53248));
    expect(total(blocks.slice(constant + 1), 'builds')).toBe(8);
  });

  // the voices back on their mix tables after a new version of their tables (an edit of a frame, a preset):
  // within TABLE_THROTTLE, the edits of a frame the oscillator sends at most, at 44.1 and 48 kHz. At 96 kHz
  // they take 268 ms (F1): a continuous edit keeps them on the direct path
  it.each([
    [44100, 20],
    [48000, 19],
    [96000, 201],
  ])(
    'at %i Hz a new version of both tables under the heavy chord: on their mixes again after %j blocks',
    (rate, backs) => {
      const back = backs;
      const { run, store, freed } = chord(rate);
      run(260);
      const levels = buildLevels(FRAMES.map((frame) => frame.map((v) => 0.9 * v)));
      store.set('a', 2, levels);
      store.set('b', 2, buildLevels(FRAMES.map((frame) => frame.map((v) => 0.8 * v))));
      const before = freed.length;
      const blocks: VoiceStats[] = [];
      const freedAt: number[] = [];
      for (let i = 0; i < 260; i++) {
        blocks.push(run(1)[0]);
        freedAt.push(freed.length - before);
      }
      // the crossfade into the new versions, then the old ones are freed (their buffers go back to the worker)
      const crossfade = Math.ceil((CROSSFADE * rate) / BLOCK);
      expect(freedAt[crossfade - 2]).toBe(0);
      expect(freedAt[crossfade - 1]).toBe(2);
      expect(store.stats()).toMatchObject({ tables: 2, versions: 2 });
      expect(settled(blocks)).toBe(back);
      const ms = ((back * BLOCK) / rate) * 1000;
      if (rate <= 48000) expect(ms).toBeLessThan(TABLE_THROTTLE);
      else expect(ms).toBeGreaterThan(TABLE_THROTTLE);
    }
  );

  it.each([
    [44100, 882],
    [48000, 960],
    [96000, 1920],
  ])('at %i Hz a stolen voice fades out in %i frames (20 ms) and ends', (rate, fade) => {
    expect(Math.round(KILL_FADE * rate)).toBe(fade);
    const { store } = coreStoreWith({ a: FRAMES, b: FRAMES });
    const scope = coreScope(rate, store);
    const voice = scope.add(OSCS, params([4, 'A'] as Note));
    Array.from({ length: 4 }, () => scope.block());
    voice.params.gate = -1;
    const blocks = Array.from({ length: 20 }, () => scope.block());
    expect(blocks.findIndex((block) => block.voices === 0)).toBe(Math.ceil(fade / BLOCK) - 1);
    expect(voice.ended).toBe(true);
  });
});
