import { Note } from '@waveform/ui-kit';
import { createSynth, stopModels } from '../../test-utils/models';
import { createOfflineEngine } from '../../test-utils/offline-engine';
import { voicesNodes, voiceWork } from '../../test-utils/voice-events';
import { seeded } from '../../test-utils/voice-dsp';
import { tableBytes } from './common/wavetable/wavetable-mipmap';
import { KILL_FADE } from './common/wavetable/voice-options';

// the synth played for a long time, offline (it replaces the endurance scene of the browser suite, its random
// patches every 5 s for 10 min, and the settling of its table switches): the models, the worker's builder,
// the store and the voices node of the notes together. Whatever was played, once the notes have ended
// nothing is left: the store holds one version a table, no voice, no knob follows a voice, and the store is
// empty once the oscillators are gone

const NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const note = (n: number): Note => [3 + Math.floor(n / NOTES.length), NOTES[n % NOTES.length]] as Note;

// the wavetable oscillator loads its module asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));

const setup = async (random = seeded(10)) => {
  const engine = createOfflineEngine(random);
  const modules = createSynth();
  await flush();
  const [{ audioCtx, wavetables }] = modules.synthCore;
  engine.attach(audioCtx, wavetables);
  engine.flushWorker();
  const [, { onPress, onRelease }] = modules.inputController;
  // renders until every voice has ended (the release, the fade of a stolen voice)
  const settle = (most = 400) => {
    for (let i = 0; i < most && engine.alive() > 0; i++) engine.render();
  };
  return { ...modules, audioCtx, wavetables, engine, onPress, onRelease, settle };
};

// a table of `frames` random frames of 64 samples (cheap to build)
const randomTable = (random: () => number, frames: number) =>
  Array.from({ length: frames }, () => Array.from({ length: 64 }, () => random() * 2 - 1));

describe('the synth played for a long time', () => {
  it('after 30 random patches with chords, steals, legato and new tables nothing is left', async () => {
    const random = seeded(10);
    const { engine, onPress, onRelease, settle, osc1, osc2, synth, envelopes, audioCtx, wavetables } =
      await setup(random);
    const [, synthActions] = synth;
    envelopes[1].setEnvelopeValue('env1', 'release', 0.05);
    let peak = 0;
    let crossfades = 0;
    for (let patch = 0; patch < 30; patch++) {
      osc1[1].setOscValue('unison', 1 + Math.floor(random() * 8));
      // osc 1 up to 3 octaves up (the notes of a table of 64 samples read its level 0 alone below 600 Hz: up there
      // they cross the crossfades of its levels, where the voices build mixes)
      osc1[1].setOscValue('octave', patch % 4);
      osc2[1].setOscValue('unison', 1 + Math.floor(random() * 8));
      if (random() < 0.5) osc2[1].toggleActive();
      synthActions.setMaxVoices(random() < 0.5 ? 8 : 12);
      synthActions.setPortamento(random() < 0.5 ? 0 : 50);
      synthActions.setLegato(random() < 0.2);
      // a new table: built before the chord, or while it plays (the voices crossfade into it)
      const early = random() < 0.5;
      (random() < 0.5 ? osc1 : osc2)[1].setWaveTable(randomTable(random, 2 + Math.floor(random() * 3)));
      if (early) engine.flushWorker();
      const chord = Array.from({ length: 12 }, (_, i) => note(i));
      chord.forEach((n) => onPress(n));
      engine.render(4);
      if (!early) {
        engine.flushWorker();
        // the voices hold the replaced version until they have crossfaded into the new one
        if (engine.store.stats().versions > 2) crossfades++;
      }
      engine.render(8);
      peak = Math.max(peak, engine.alive());
      chord.forEach((n) => onRelease(n));
      settle();
      expect(engine.alive()).toBe(0);
    }
    expect(peak).toBeGreaterThan(8);
    expect(crossfades).toBeGreaterThan(2);
    const { mixSamples, directSamples, builds } = engine.shared.stats();
    expect(mixSamples).toBeGreaterThan(0);
    expect(directSamples).toBeGreaterThan(0);
    expect(builds).toBeGreaterThan(0);
    expect(engine.made()).toBeGreaterThan(200);
    // one version a table, the bytes of the latest tables of the oscillators
    const tables = [osc1, osc2].map(([model]) => model.$waveTable.value.map((frame) => frame.value));
    expect(engine.store.stats()).toEqual({
      tables: 2,
      versions: 2,
      bytes: tables.reduce((sum, frames) => sum + tableBytes(frames), 0),
    });
    expect(engine.shared.stats()).toMatchObject({ voices: 0, unison: 0 });
    // every note in one node
    expect(voicesNodes(audioCtx)).toHaveLength(1);
    expect(engine.pool().pooled).toBeLessThanOrEqual(2);
    expect(voiceWork(audioCtx, wavetables, () => osc1[1].setGain(0.3)).messages).toBe(0);
    // the oscillators gone: their tables are removed from the store
    stopModels();
    engine.flushWorker();
    expect(engine.store.stats()).toEqual({ tables: 0, versions: 0, bytes: 0 });
  });

  it('a chord of 12 at Poly 8: the 4 voices stolen as they start fade out and end, 8 play on', async () => {
    const { engine, onPress, audioCtx } = await setup();
    Array.from({ length: 12 }, (_, i) => note(i)).forEach((n) => onPress(n));
    engine.render();
    expect(engine.alive()).toBe(12);
    // the fade of a stolen voice (20 ms): they end in its last block
    const fade = Math.ceil((KILL_FADE * audioCtx.sampleRate) / 128);
    engine.render(fade - 2);
    expect(engine.alive()).toBe(12);
    engine.render();
    expect(engine.alive()).toBe(8);
    engine.render(100);
    expect(engine.alive()).toBe(8);
  });

  it('trills, 20 notes a second for 10 s: never more than 2 voices alive, all of them ended at the end', async () => {
    const { engine, onPress, onRelease, envelopes, audioCtx, settle } = await setup();
    envelopes[1].setEnvelopeValue('env1', 'release', 0.05);
    const blocks = (seconds: number) => Math.round((seconds * audioCtx.sampleRate) / 128);
    let most = 0;
    for (let i = 0; i < 200; i++) {
      const n = note(i % 2);
      onPress(n);
      engine.render(blocks(0.04));
      most = Math.max(most, engine.alive());
      onRelease(n);
      engine.render(blocks(0.01));
      most = Math.max(most, engine.alive());
    }
    settle();
    expect(engine.made()).toBe(200);
    expect(most).toBe(2);
    expect(engine.alive()).toBe(0);
  });
});
