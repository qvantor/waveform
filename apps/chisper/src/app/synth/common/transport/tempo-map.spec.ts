import {
  beatAt,
  firstSegment,
  nextSegment,
  segmentAt,
  TEMPO_SEGMENTS,
  timeAt,
  withSegment,
} from './tempo-map';

describe('tempo map', () => {
  it('starts at beat 0 at the time 0 of the context', () => {
    const segments = [firstSegment(120)];
    expect(beatAt(segments, 0)).toBe(0);
    expect(beatAt(segments, 1.5)).toBe(3);
    expect(timeAt(segments, 3)).toBe(1.5);
  });

  it('goes on at the beat of a new tempo: no step of the beat', () => {
    const before = [firstSegment(120)];
    const segment = nextSegment(before, 1.31, 60);
    expect(segment).toEqual({ time: 1.31, beat: 2.62, bpm: 60 });
    const segments = withSegment(before, segment);
    expect(beatAt(segments, 1)).toBe(2);
    expect(beatAt(segments, 1.31)).toBe(2.62);
    expect(beatAt(segments, 2.31)).toBeCloseTo(3.62, 12);
    // a beat from now on: on the newest segment
    expect(timeAt(segments, 4.62)).toBeCloseTo(3.31, 12);
  });

  it('takes the segment of a time: the last one from before it, else the first', () => {
    const segments = [firstSegment(120), { time: 1, beat: 2, bpm: 60 }, { time: 2, beat: 0, bpm: 90 }];
    expect(segmentAt(segments, 0.5)).toBe(segments[0]);
    expect(segmentAt(segments, 1)).toBe(segments[1]);
    expect(segmentAt(segments, 5)).toBe(segments[2]);
    expect(segmentAt(segments.slice(1), 0.5)).toBe(segments[1]);
    // a locate: the beat steps
    expect(beatAt(segments, 1.99)).toBeCloseTo(2.99, 12);
    expect(beatAt(segments, 2.5)).toBe(0.75);
  });

  it('keeps the newest segments, a new one replaces those from its time on', () => {
    let segments = [firstSegment(120)];
    for (let i = 1; i <= 6; i += 1) segments = withSegment(segments, { time: i, beat: i, bpm: 60 + i });
    expect(segments).toHaveLength(TEMPO_SEGMENTS);
    expect(segments.map(({ time }) => time)).toEqual([3, 4, 5, 6]);
    segments = withSegment(segments, { time: 4.5, beat: 10, bpm: 100 });
    expect(segments.map(({ time }) => time)).toEqual([3, 4, 4.5]);
  });
});
