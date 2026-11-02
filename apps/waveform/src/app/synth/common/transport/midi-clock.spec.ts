import { readFileSync } from 'fs';
import { join } from 'path';
import { CLOCK_MIN_TICKS, CLOCK_WINDOW, ClockTransport, createMidiClock, PPQN } from './midi-clock';
import { beatAt, firstSegment, segmentAt, TempoSegment, withSegment } from './tempo-map';

// a transport on a tempo map of its own: its segments where it is told (no lead)
const transportAt = (bpm = 120) => {
  let segments = [firstSegment(bpm)];
  const follows: TempoSegment[] = [];
  const locates: [number, number, number | undefined][] = [];
  const playing: boolean[] = [];
  const transport: ClockTransport = {
    beatAt: (t) => beatAt(segments, t),
    tempoAt: (t) => segmentAt(segments, t).bpm,
    follow: (segment) => {
      follows.push(segment);
      segments = withSegment(segments, segment);
    },
    locate: (beat, at, to = segmentAt(segments, at).bpm) => {
      locates.push([beat, at, to]);
      segments = withSegment(segments, { time: at, beat, bpm: to });
    },
    setPlaying: (value) => playing.push(value),
    // the page and the context on one clock
    contextTime: (seconds) => seconds,
  };
  return { transport, follows, locates, playing, segments: () => segments };
};

// a deterministic jitter within ±`ms` (a linear congruential generator)
const jitter = (ms: number) => {
  let seed = 12345;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return ((seed / 2 ** 31) * 2 - 1) * (ms / 1000);
  };
};

// `count` clocks at `bpm` from `from` (seconds), with a jitter
const clocks = (
  clock: ReturnType<typeof createMidiClock>,
  bpm: number,
  from: number,
  count: number,
  noise = () => 0
) => {
  const step = 60 / bpm / PPQN;
  for (let i = 0; i < count; i++) clock.tick(from + i * step + noise());
  return from + count * step;
};

describe('MIDI Clock', () => {
  it('works the tempo out of a beat of clocks at least, to 0.01 BPM through a jitter of ±0.1 ms', () => {
    const { transport } = transportAt();
    const clock = createMidiClock(transport);
    const t = clocks(clock, 128, 1, CLOCK_MIN_TICKS - 1);
    expect(clock.tempo()).toBeNull();
    clocks(clock, 128, t, 100, jitter(0.1));
    expect(Math.abs((clock.tempo() as number) - 128)).toBeLessThan(0.01);
  });

  it('a jitter of ±0.5 ms moves its tempo less than the tolerance of a new segment: nothing is set', () => {
    const { transport, follows } = transportAt(128);
    const clock = createMidiClock(transport);
    clocks(clock, 128, 1, 20 * PPQN, jitter(0.5));
    expect(Math.abs((clock.tempo() as number) - 128) / 128).toBeLessThan(0.0005);
    expect(follows).toEqual([]);
  });

  it('plays a tempo out of the range of the field at its end: 400 BPM at 300, 10 at 20', () => {
    for (const [bpm, played] of [
      [400, 300],
      [10, 20],
    ]) {
      const { transport, follows } = transportAt();
      const clock = createMidiClock(transport);
      clocks(clock, bpm, 1, 3 * PPQN);
      expect(clock.tempo()).toBe(played);
      expect(follows.length).toBeGreaterThan(0);
      expect(follows.every((segment) => segment.bpm === played)).toBe(true);
    }
  });

  it('takes a window of clocks taken at once (a stall of the main thread) for no tempo: none is set', () => {
    const { transport, follows } = transportAt(128);
    const clock = createMidiClock(transport);
    const t = clocks(clock, 128, 1, 2 * CLOCK_WINDOW);
    expect(clock.tempo()).toBeCloseTo(128, 6);
    const before = follows.length;
    // a window at one time, then a window microseconds apart
    for (let i = 0; i < CLOCK_WINDOW; i++) clock.tick(t + 2);
    expect(clock.tempo()).toBeNull();
    for (let i = 0; i < CLOCK_WINDOW; i++) clock.tick(t + 3 + i * 1e-6);
    expect(clock.tempo()).toBeNull();
    // the windows in between (clocks of before and of the stall): a tempo within the range at most
    expect(follows.slice(before).every(({ bpm }) => bpm >= 20 && bpm <= 300)).toBe(true);
  });

  it('stopped, leads the tempo of the transport, the beat going on', () => {
    const { transport, follows, segments } = transportAt();
    const clock = createMidiClock(transport);
    const before = beatAt(segments(), 2);
    const t = clocks(clock, 90, 1, 3 * PPQN);
    expect(follows.length).toBeGreaterThan(0);
    expect(follows[0].bpm).toBeCloseTo(90, 6);
    // the beat where the transport was: no step
    expect(follows[0].beat).toBeCloseTo(beatAt([firstSegment(120)], follows[0].time), 9);
    expect(beatAt(segments(), 2)).not.toBe(before);
    // once the tempo holds, nothing more
    const count = follows.length;
    clocks(clock, 90, t, 4 * PPQN);
    expect(follows.length).toBe(count);
  });

  it('sets a segment once a beat at most', () => {
    const { transport, follows } = transportAt();
    const clock = createMidiClock(transport);
    // the tempo drifts a little every clock
    for (let i = 0, t = 1; i < 10 * PPQN; i++, t += 60 / (100 + i * 0.01) / PPQN) clock.tick(t);
    const beats = follows.map(({ beat }) => beat);
    beats.slice(1).forEach((beat, i) => expect(beat - beats[i]).toBeGreaterThanOrEqual(1 - 1e-9));
  });

  it('Start takes the transport to beat 0 at the next clock, the beats follow the clocks', () => {
    const { transport, locates, playing, segments } = transportAt();
    const clock = createMidiClock(transport);
    let t = clocks(clock, 140, 0.5, 2 * PPQN);
    clock.start();
    expect(playing).toEqual([true]);
    expect(locates).toEqual([]);
    t = clocks(clock, 140, t, 1);
    expect(locates).toHaveLength(1);
    expect(locates[0][0]).toBe(0);
    expect(locates[0][2]).toBeCloseTo(140, 6);
    // 4 beats later the transport is at beat 4 at the clock
    const step = 60 / 140 / PPQN;
    clocks(clock, 140, t, 4 * PPQN);
    expect(beatAt(segments(), t - step + 4 * PPQN * step)).toBeCloseTo(4, 6);
  });

  it('Stop holds the position, Continue goes on from it at the next clock', () => {
    const { transport, locates, playing } = transportAt();
    const clock = createMidiClock(transport);
    let t = clocks(clock, 120, 0, PPQN);
    clock.start();
    t = clocks(clock, 120, t, 2 * PPQN + 1);
    clock.stop();
    t = clocks(clock, 120, t, PPQN);
    clock.continue();
    clocks(clock, 120, t, 1);
    expect(playing).toEqual([true, false, true]);
    // the clock after the 49 of the start: 2 beats and one clock
    expect(locates.at(-1)?.[0]).toBeCloseTo(2 + 1 / PPQN, 12);
  });

  it('a Song Position takes the transport there, the next Continue goes on from it', () => {
    const { transport, locates } = transportAt();
    const clock = createMidiClock(transport);
    clock.songPosition(16, 3);
    // 16 sixteenths: 4 beats
    expect(locates).toEqual([[4, 3, 120]]);
    clock.continue();
    clock.tick(3.2);
    expect(locates.at(-1)?.[0]).toBe(4);
    // while running nothing
    clock.songPosition(64, 4);
    expect(locates).toHaveLength(2);
  });

  // a DAW that sends no clocks while stopped, started again sooner than CLOCK_LOST_MS: the clocks before the pause
  // are not on the line of those after it
  it.each([
    ['Start', 0],
    ['Continue', 2 + 1 / PPQN],
  ] as const)(
    '%s after a pause of the clocks: its beat at the first clock after it, on the clocks',
    (name, beat) => {
      const { transport, locates, follows, segments } = transportAt();
      const clock = createMidiClock(transport);
      const step = 60 / 120 / PPQN;
      let t = clocks(clock, 120, 1, PPQN);
      clock.start();
      t = clocks(clock, 120, t, 2 * PPQN + 1);
      clock.stop();
      const from = t + 0.3;
      if (name === 'Start') clock.start();
      else clock.continue();
      const count = follows.length;
      clocks(clock, 120, from, 4 * PPQN);
      const [located, at, bpm] = locates.at(-1) as [number, number, number];
      expect(located).toBeCloseTo(beat, 12);
      expect(at).toBe(from);
      expect(bpm).toBeCloseTo(120, 6);
      for (let k = 0; k < 4 * PPQN; k++)
        expect(beatAt(segments(), from + k * step)).toBeCloseTo(beat + k / PPQN, 6);
      expect(follows.slice(count).every((segment) => Math.abs(segment.bpm - 120) < 1e-6)).toBe(true);
    }
  );

  it('stopped, clocks started again at another phase lead their tempo: the ones before Stop are not on its line', () => {
    const { transport, follows } = transportAt();
    const clock = createMidiClock(transport);
    const step = 60 / 120 / PPQN;
    let t = clocks(clock, 120, 1, PPQN);
    clock.start();
    t = clocks(clock, 120, t, 2 * PPQN);
    clock.stop();
    const count = follows.length;
    // the DAW starts its clocks again half a clock later
    clocks(clock, 120, t + step / 2, 4 * PPQN);
    expect(clock.tempo()).toBeCloseTo(120, 6);
    expect(follows.slice(count).every((segment) => Math.abs(segment.bpm - 120) < 0.01)).toBe(true);
  });

  it('lost, keeps the position of the next Continue (a DAW stopped sends no clocks); reset forgets it', () => {
    for (const [forget, beat] of [
      ['lose', 2 + 1 / PPQN],
      ['reset', 0],
    ] as const) {
      const { transport, locates } = transportAt();
      const clock = createMidiClock(transport);
      let t = clocks(clock, 120, 0, PPQN);
      clock.start();
      t = clocks(clock, 120, t, 2 * PPQN + 1);
      clock.stop();
      clock[forget]();
      expect(clock.tempo()).toBeNull();
      clock.continue();
      clocks(clock, 120, t + 1, 1);
      expect(locates.at(-1)?.[0]).toBeCloseTo(beat, 12);
    }
  });

  it.each(['lose', 'reset'] as const)('%s forgets the clocks and a Start without them', (forget) => {
    const { transport, locates, playing } = transportAt();
    const clock = createMidiClock(transport);
    clocks(clock, 120, 0, 2 * PPQN);
    clock.start();
    clock[forget]();
    expect(clock.tempo()).toBeNull();
    expect(playing).toEqual([true, false]);
    // the Start is gone: the next clock takes the transport nowhere
    clocks(clock, 120, 2, 1);
    expect(locates).toEqual([]);
  });

  // 880 clocks of 110 BPM a script sent through IAC Driver Bus 1, as Chrome took them (ms from the first, by
  // performance.now(): it stamps a MIDI message 0), 16..27.7 ms apart
  const ARRIVALS: number[] = JSON.parse(readFileSync(join(__dirname, 'midi-clock-arrivals.json'), 'utf8'));

  it('takes the tempo of clocks Chrome took to 0.1 BPM, setting a segment now and then', () => {
    const { transport, follows } = transportAt(110);
    const clock = createMidiClock(transport);
    const errors: number[] = [];
    ARRIVALS.forEach((ms, i) => {
      clock.tick(1 + ms / 1000);
      if (i >= 4 * PPQN) errors.push(Math.abs((clock.tempo() as number) - 110));
    });
    expect(Math.max(...errors)).toBeLessThan(0.1);
    // 36 beats: once a beat at most, mostly fewer
    expect(follows.length).toBeLessThan(18);
  });

  it('keeps the beats of the transport within 2 ms of clocks taken up to 70 ms late', () => {
    const { transport, segments } = transportAt();
    const clock = createMidiClock(transport);
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const step = 60 / 110 / PPQN;
    clock.start();
    for (let i = 0; i < 32 * PPQN; i++)
      clock.tick(1 + i * step + (random() < 0.3 ? random() * 0.07 : random() * 0.002));
    expect(Math.abs((clock.tempo() as number) - 110)).toBeLessThan(0.1);
    // the clocks themselves: clock k at beat k/24
    for (let k = 31 * PPQN; k < 32 * PPQN; k++)
      expect(Math.abs((beatAt(segments(), 1 + k * step) - k / PPQN) * step * PPQN * 1000)).toBeLessThan(2);
  });
});
