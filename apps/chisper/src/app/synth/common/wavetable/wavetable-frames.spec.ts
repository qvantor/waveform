import { readFileSync } from 'fs';
import { join } from 'path';
import {
  crossfadeFrames,
  expandFrames,
  keyFrame,
  morphedFrame,
  MORPHED_FRAMES,
  playedFrame,
  playedFrames,
} from './wavetable-frames';

// an Audio Unit playing tables of ours (scripts/renders/run.mjs): frame j of a table a sine of harmonic j + 1
interface MeasuredFrames {
  played: Record<string, { edge: number; below: number; above: number }[]>;
  // per expanded frame: the source frame below and the share of the next one
  morphed: Record<string, [number, number][]>;
  // the harmonics 1 and 2 at e = 128 of 2 frames, against frame 0
  marks: Record<
    string,
    { h1: { amplitude: number; phase: number }; h2: { amplitude: number; phase: number } }
  >;
}
const MEASURED: MeasuredFrames = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../../dsp/measurements/frames.json'), 'utf8')
);

describe('the frames of a table, as measured', () => {
  it.each(Object.keys(MEASURED.played))('plays frame ceil(share × %s) - 1: its edges', (n) => {
    const count = Number(n);
    for (const { edge, below, above } of MEASURED.played[n]) {
      expect(playedFrame(edge - 1e-4, count)).toBe(below);
      expect(playedFrame(edge + 1e-4, count)).toBe(above);
    }
    expect(playedFrame(0, count)).toBe(0);
    expect(playedFrame(1, count)).toBe(count - 1);
    expect(playedFrame(-1, count)).toBe(0);
    expect(playedFrame(2, count)).toBe(count - 1);
  });

  it.each(Object.keys(MEASURED.morphed))(
    'expands %s frames with a morph mark as measured: its frames, its shares between',
    (n) => {
      const count = Number(n);
      MEASURED.morphed[n].forEach(([frame, share], e) => {
        const ours = morphedFrame(e, count);
        // (the last frame: the share 1 of the frame below)
        const [j, w] = ours.share === 1 ? [ours.frame + 1, 0] : [ours.frame, ours.share];
        expect({ e, frame: j }).toEqual({ e, frame });
        expect(w).toBeCloseTo(share, 3);
      });
      for (let j = 0; j < count; j++)
        expect(morphedFrame(keyFrame(j, count), count)).toEqual(
          j < count - 1 ? { frame: j, share: 0 } : { frame: j - 1, share: 1 }
        );
    }
  );

  it('crossfades for any morph mark, none without one (the marks 2..4 are spectral in its editor, not at load)', () => {
    // 2 frames: h1 1 at 0° and 0.5 at 120°; at e = 128 the share of frame 1 is 129 / 256
    const { share } = morphedFrame(128, 2);
    expect(share).toBe(129 / 256);
    const re = 1 - share + share * 0.5 * Math.cos((2 * Math.PI) / 3);
    const im = share * 0.5 * Math.sin((2 * Math.PI) / 3);
    for (const mark of ['10000000', '20000000', '30000000', '40000000']) {
      expect(MEASURED.marks[mark].h1.amplitude).toBeCloseTo(Math.hypot(re, im), 3);
      expect(MEASURED.marks[mark].h1.phase).toBeCloseTo((Math.atan2(im, re) * 180) / Math.PI, 1);
    }
    // no morph: frame 1 alone
    for (const mark of ['00000000', '01000000'])
      expect(MEASURED.marks[mark].h1).toEqual({ amplitude: 0.5, phase: 120 });
  });

  it('plays a table of fewer than 256 frames with a morph as 256, the others as they are', () => {
    expect(playedFrames(4, true)).toBe(MORPHED_FRAMES);
    expect(playedFrames(4, false)).toBe(4);
    expect(playedFrames(1, true)).toBe(1);
    expect(playedFrames(256, true)).toBe(256);
  });

  it('expands to 256 frames: the frames of the table at their places, crossfades between', () => {
    const frames = [0, 1, 2].map((j) => Float32Array.from({ length: 8 }, (_, i) => j * 10 + i));
    const expanded = expandFrames(frames);
    expect(expanded).toHaveLength(MORPHED_FRAMES);
    expect(expanded[0]).toEqual(frames[0]);
    expect(expanded[128]).toEqual(frames[1]);
    expect(expanded[255]).toEqual(frames[2]);
    const { share } = morphedFrame(64, 3);
    expect(expanded[64]).toEqual(crossfadeFrames(frames[0], frames[1], share));
  });
});
