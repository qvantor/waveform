// the map of the tempo: beats (quarter notes) on the clock of the context. No imports: the main thread and the
// specs share it (a track of notes would schedule by it)

// from `time` (seconds of the context) on the transport is at `beat` there and moves `bpm` beats a minute
export interface TempoSegment {
  time: number;
  beat: number;
  bpm: number;
}

// the segments kept (the newest ones): as the anchors of an LFO, enough for the states on their way
export const TEMPO_SEGMENTS = 4;

// the transport before any change: beat 0 at the time 0 of the context (the first anchor of an LFO is there)
export const firstSegment = (bpm: number): TempoSegment => ({ time: 0, beat: 0, bpm });

// the segment at `t`: the last one from before it, else the first one
export const segmentAt = (segments: readonly TempoSegment[], t: number) => {
  for (let i = segments.length - 1; i > 0; i -= 1) if (segments[i].time <= t) return segments[i];
  return segments[0];
};

export const beatOn = ({ time, beat, bpm }: TempoSegment, t: number) => beat + ((t - time) * bpm) / 60;

// the beat the transport is at at `t`
export const beatAt = (segments: readonly TempoSegment[], t: number) => beatOn(segmentAt(segments, t), t);

// the time the transport comes to `beat` at, on the newest segment (from now on: a beat to schedule at)
export const timeAt = (segments: readonly TempoSegment[], beat: number) => {
  const { time, beat: from, bpm } = segments[segments.length - 1];
  return time + ((beat - from) * 60) / bpm;
};

// a segment from `t` on at `bpm`: at the beat the transport is at there (no step)
export const nextSegment = (segments: readonly TempoSegment[], t: number, bpm: number): TempoSegment => ({
  time: t,
  beat: beatAt(segments, t),
  bpm,
});

// the segments with `segment`: those from its time on replaced, the newest TEMPO_SEGMENTS kept
export const withSegment = (segments: readonly TempoSegment[], segment: TempoSegment) =>
  [...segments.filter(({ time }) => time < segment.time), segment].slice(-TEMPO_SEGMENTS);
