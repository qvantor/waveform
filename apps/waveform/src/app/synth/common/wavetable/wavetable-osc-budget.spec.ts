import { Note } from '@waveform/ui-kit';
import { getFq } from '../../services';
import { TABLE_THROTTLE } from '../modules/oscillator';
import { BLOCK, createVoiceScope, storeWith, VoiceParams } from '../../../../test-utils/voice-dsp';
import { buildLevels } from './wavetable-mipmap';
import { CROSSFADE, KILL_FADE, VoiceOscOptions, VoiceStats } from './voice-options';
import { WASM_MIX_BUDGET } from './wavetable-osc-wasm';

// the work of the voices on the audio thread as exact counts (it replaces the CPU scenes of the browser suite
// but the heavy patch, S5): the samples each unison voice plays from one table (its mix, or the frame of its level
// alone) or directly from the levels, the mix builds, their multiply-adds and the blocks they take. The counts don't depend on the
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
// the blocks up to the one from which every voice plays one table, no build left
const settled = (blocks: VoiceStats[]) =>
  blocks.findIndex((_, i) =>
    blocks.slice(i).every((block) => block.directSamples === 0 && block.builds === 0)
  );

describe('the work of the voices', () => {
  // the unison voices whose pitch is in the crossfade of a level into the next (its top fifth of a third of an
  // octave) build a mix, the others read the frame of their level alone from the first block. The multiply-adds of
  // a mix (build_cost of the voice): its fill (as long as its level) and each of the 2 levels it reads, added as it
  // is when as long, interpolated at 6 points a sample when half as long; one frame: 12,288 = 3 · 4096 (both
  // levels 4096 long: the low notes), 32,768 = 4096 + 4096 + 6 · 4096 (the next is 2048 long), 6,144 = 3 · 2048
  // (both 2048 long). At 96 kHz the pitches are lower against the nyquist, on levels of 4096 (the mixes were as long
  // as a native table there, 16,384 samples: one a block, the chord took 192 blocks, F1)
  it.each([
    [44100, 50, 808960, 4],
    [48000, 32, 557056, 3],
    [96000, 32, 32 * 12288, 3],
  ])(
    'at %i Hz the %i unison voices of the heavy chord in a crossfade build their mixes (%i multiply-adds) within the budget, the last in block %j',
    (rate, mixes, cost, lasts) => {
      const last = lasts;
      const { run } = chord(rate);
      const blocks = run(40);
      // the first block: the levels alone, the others directly (the mixes are built in the second block of
      // constant params)
      expect(blocks[0]).toMatchObject({
        directSamples: mixes * BLOCK,
        mixSamples: (UNISON - mixes) * BLOCK,
        builds: 0,
      });
      expect(total(blocks, 'builds')).toBe(mixes);
      expect(total(blocks, 'buildCost')).toBe(cost);
      // a block builds until its next mix would go over the budget
      expect(blocks[1].peakCost).toBeGreaterThan(core.budget - 32768);
      blocks.forEach((block) => expect(block.peakCost).toBeLessThanOrEqual(core.budget));
      expect(lastBuild(blocks) + 1).toBe(last);
      expect(last - 1).toBeGreaterThanOrEqual(Math.ceil(cost / core.budget));
      // then, once the voices have glided from their levels into their mixes (5 ms at most), every unison voice
      // plays one table, nothing directly
      expect(settled(blocks)).toBeLessThanOrEqual(last + Math.ceil((0.005 * rate) / BLOCK));
      blocks
        .slice(settled(blocks))
        .forEach((block) => expect(block).toMatchObject({ directSamples: 0, mixSamples: UNISON * BLOCK }));
    }
  );

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

  it('a gliding pitch reads its levels alone over their flats, directly over the crossfades; its mixes are built in the second block after it settles', () => {
    const { store } = coreStoreWith({ a: FRAMES, b: FRAMES });
    const scope = coreScope(48000, store);
    // a portamento of 100 ms (37.5 blocks) from 220 Hz up to the middle of the crossfade of level 13 into 14 (462
    // Hz: x 13.9)
    const glide = 4800;
    const to = (24000 / 1024) * 2 ** ((13.9 - 1) / 3);
    scope.add([OSCS[0], null], {
      ...params([4, 'A'] as Note),
      frequency: (frame) => (frame < glide ? 220 + ((to - 220) * frame) / glide : to),
    });
    const blocks = Array.from({ length: 50 }, () => scope.block());
    const constant = Math.ceil(glide / BLOCK);
    blocks.slice(0, constant + 1).forEach((block) => expect(block.builds).toBe(0));
    expect(total(blocks.slice(0, constant), 'mixSamples')).toBeGreaterThan(total(blocks, 'directSamples'));
    expect(blocks.findIndex((block) => block.builds > 0)).toBe(constant + 1);
    // its 8 mixes in that block: 6,144 multiply-adds each (both levels 2048 long)
    expect(blocks[constant + 1]).toMatchObject({ builds: 8, buildCost: 8 * 6144 });
    expect(total(blocks.slice(constant + 1), 'builds')).toBe(8);
  });

  it('a voice that leaves a crossfade gives its mix back: the next one built takes it from the pool', () => {
    const { store } = coreStoreWith({ a: FRAMES, b: FRAMES });
    const scope = coreScope(48000, store);
    // x 13.9 (the crossfade of level 13 into 14: a mix), x 13.5 (the flat of level 13)
    const crossfade = (24000 / 1024) * 2 ** ((13.9 - 1) / 3);
    const flat = (24000 / 1024) * 2 ** ((13.5 - 1) / 3);
    const alone = [{ ...OSCS[0], unison: 1 }, null];
    scope.add(alone, {
      ...params([4, 'A'] as Note),
      frequency: (frame) => (frame < 8 * BLOCK ? crossfade : flat),
    });
    const before = Array.from({ length: 16 }, () => scope.block());
    scope.add(alone, { ...params([4, 'A'] as Note), frequency: crossfade });
    const after = Array.from({ length: 8 }, () => scope.block());
    expect(total(before, 'builds') + total(after, 'builds')).toBe(2);
    expect(total(before, 'mixes') + total(after, 'mixes')).toBe(1);
  });

  it('a bend held still under the heavy chord: the voices play the tables whose reach holds it until theirs are built, then glide into them', () => {
    const { scope, run } = chord(48000);
    run(40);
    // 60 cents up over 20 blocks, then held: each mix reaches 100 cents up but where its richest level reaches
    // the nyquist
    const from = scope.frame;
    const bend = (frame: number) => 60 * Math.min(1, (frame - from) / (20 * BLOCK));
    scope.voices.forEach(({ params }) => {
      params.detune1 = bend;
      params.detune2 = (frame) => -1200 + bend(frame);
    });
    const blocks = run(60);
    // block 20: the pitch still, the one of the block before another: the tables whose reach holds it
    expect(blocks[20].mixSamples).toBeGreaterThan((UNISON * BLOCK) / 2);
    // then steady: the mixes of the 30 voices bent into a crossfade, within the budget, each glided into from the
    // table whose reach held it (a glide of 5 ms at most, played directly: in the block it is built in and the next
    // one); meanwhile no other voice leaves the one it plays
    blocks
      .slice(21)
      .forEach((block, i) =>
        expect(block.directSamples).toBeLessThanOrEqual(
          blocks[20].directSamples + BLOCK * (block.builds + blocks[20 + i].builds)
        )
      );
    expect(total(blocks.slice(21), 'builds')).toBe(30);
    expect(blocks[blocks.length - 1]).toMatchObject({ directSamples: 0, mixSamples: UNISON * BLOCK });
  });

  // the voices back on one table after a new version of their tables (an edit of a frame, a preset): within
  // TABLE_THROTTLE, the edits of a frame the oscillator sends at most (at 96 kHz too: the mixes as long as their
  // levels; as long as a native table there they took 268 ms, F1)
  it.each([
    [44100, 8],
    [48000, 7],
    [96000, 11],
  ])(
    'at %i Hz a new version of both tables under the heavy chord: on one table again after %j blocks',
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
      expect(((back * BLOCK) / rate) * 1000).toBeLessThan(TABLE_THROTTLE);
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
