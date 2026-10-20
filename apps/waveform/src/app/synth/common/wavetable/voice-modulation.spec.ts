import { createEnvelopeBlock } from '../envelope/envelope-block';
import { EnvelopeParams } from '../envelope/envelope-curve';
import { createVoiceModulation } from './voice-modulation';

const RATE = 48000;
const BLOCK = 128;
const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
// ENV 2: a sustain of 0.5 from the start
const SUSTAIN: EnvelopeParams = { ...FLAT, sustain: 0.5 };

// a voice starting at `start` whose ENV 2 moves gain1 by -1, block by block in the order of the voice
// (wavetable-osc-dsp.ts): the envelopes the routes read, then the params they move
const setup = (start: number) => {
  const envelopes = [FLAT, SUSTAIN].map((params) => createEnvelopeBlock(params, RATE, start));
  let gain: Float32Array | null = null;
  const modulation = createVoiceModulation(
    RATE,
    envelopes,
    [{ env: 1, param: 'gain1', amount: -1, min: 0, max: 1 }],
    { gain1: { get: (params) => params['gain1'], set: (values) => (gain = values) } }
  );
  return (frame: number, base: Float32Array) => {
    const a = Math.max(0, start - frame);
    for (let k = 1; k < envelopes.length; k++)
      if (modulation.renders(k, frame + BLOCK)) envelopes[k].render(frame, a, BLOCK);
    modulation.apply({ gain1: base }, frame, a, BLOCK, BLOCK);
    return gain;
  };
};

describe('voice modulation', () => {
  it('keeps the levels of its routes when a base changes on a flat stage, the voice started within a block', () => {
    const block = setup(64);
    expect(block(0, Float32Array.of(1))?.[0]).toBe(0.5);
    // the sustain goes on: the envelope is not rendered again
    expect(block(BLOCK, Float32Array.of(1))?.[0]).toBe(0.5);
    // the knob turned: one value, then sample by sample
    expect(block(2 * BLOCK, Float32Array.of(0.8))?.[0]).toBeCloseTo(0.3, 6);
    const moving = Float32Array.from({ length: BLOCK }, (_, i) => 0.8 - i / 1280);
    const values = block(3 * BLOCK, moving);
    [0, 31, 64, 127].forEach((i) => expect(values?.[i]).toBeCloseTo(moving[i] - 0.5, 6));
  });
});
