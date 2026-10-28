// the analysis of the Chrome traces (node --test)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzePaints } from './chrome-trace.mjs';

const thread = (tid, name) => ({ ph: 'M', name: 'thread_name', pid: 1, tid, args: { name } });
const complete = (tid, name) => ({ ph: 'X', name, pid: 1, tid, ts: 0, dur: 10 });

describe('analyzePaints', () => {
  it('counts the animation frames and the style, layout and paint of the main thread of the renderer', () => {
    const events = [
      thread(1, 'CrRendererMain'),
      thread(2, 'Compositor'),
      complete(1, 'FireAnimationFrame'),
      complete(1, 'FireAnimationFrame'),
      complete(1, 'Paint'),
      complete(1, 'UpdateLayoutTree'),
      // not of the main thread, not complete
      complete(2, 'Paint'),
      { ...complete(1, 'Layout'), ph: 'I' },
    ];
    assert.deepEqual(analyzePaints(events), { frames: 2, UpdateLayoutTree: 1, Layout: 0, Paint: 1 });
  });
});
