import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { peaksOf } from './peaks.mjs';

describe('peaksOf', () => {
  it('takes the largest |sample| of both channels in each bin, scaled to the loudest', () => {
    // frames of [left, right]: two bins of two frames
    const samples = Float32Array.from([0.1, -0.2, 0.05, 0, 0.4, 0.1, -0.8, 0.2]);
    assert.deepEqual(peaksOf(samples, 2), [0.25, 1]);
  });

  it('gives silence a flat line of zeros', () => {
    assert.deepEqual(peaksOf(new Float32Array(16), 4), [0, 0, 0, 0]);
  });
});
