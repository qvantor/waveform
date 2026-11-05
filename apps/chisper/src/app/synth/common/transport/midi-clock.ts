import { TEMPO_MAX, TEMPO_MIN } from '@chisper/preset-schema';
import type { TempoSegment } from './tempo-map';

// clocks a quarter note (MIDI Clock)
export const PPQN = 24;
// the clocks the tempo is worked out of: four beats
export const CLOCK_WINDOW = 4 * PPQN;
// clocks before their tempo leads: a beat (fewer jitter too much)
export const CLOCK_MIN_TICKS = 24;
// ms without a clock: the clock is lost, the tempo of the field leads again
export const CLOCK_LOST_MS = 500;
// a segment is set again only when the beat of the transport is off the clocks by more than this (seconds) or its
// tempo by more than this share (each one a state of the LFOs in BPM to five threads)
const BEAT_TOLERANCE = 0.001;
const TEMPO_TOLERANCE = 0.0005;
// a tempo of the clocks over this is none: a window of clocks the page took at once (a stall of the main thread
// took them in one task: 10⁴–10⁵ BPM, Infinity for one time); no DAW goes there (their tops are 999)
const CLOCK_TEMPO_MAX = 4 * TEMPO_MAX;

// what the clock leads: the transport model (its times seconds of the context), and the time of the context the
// output plays at a time of the page (seconds of performance.now())
export interface ClockTransport {
  beatAt: (t: number) => number;
  tempoAt: (t: number) => number;
  follow: (segment: TempoSegment) => void;
  locate: (beat: number, at: number, bpm?: number) => void;
  setPlaying: (playing: boolean) => void;
  contextTime: (seconds: number) => number;
}

// the line of the times of the clocks: seconds a clock, the time of the last one on it. A clock reaches the page late
// by a delay of its own, never early (the main thread takes the MIDI messages in its tasks: in Chrome, which stamps
// them 0, 0..70 ms late), so the line is their lower envelope: from the slope of the least squares, the least late
// clock of the first and of the last third of them, twice (the real clocks of 110 BPM through IAC in Chrome: the
// tempo within 0.07 BPM, the clocks within 1 ms, where the least squares are 0.2 BPM and 4 ms off); null for fewer
// than 3
const fit = (times: readonly number[]) => {
  const n = times.length;
  if (n < 3) return null;
  const meanIndex = (n - 1) / 2;
  let meanTime = 0;
  for (let i = 0; i < n; i++) meanTime += times[i];
  meanTime /= n;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (i - meanIndex) * (times[i] - meanTime);
    variance += (i - meanIndex) ** 2;
  }
  let step = covariance / variance;
  const third = Math.max(1, Math.floor(n / 3));
  let last = times[n - 1];
  for (let pass = 0; pass < 2; pass++) {
    let [first, firstTime, end, endTime] = [0, Infinity, n - 1, Infinity];
    for (let i = 0; i < third; i++)
      if (times[i] - step * i < firstTime) [first, firstTime] = [i, times[i] - step * i];
    for (let i = n - third; i < n; i++)
      if (times[i] - step * i < endTime) [end, endTime] = [i, times[i] - step * i];
    step += (endTime - firstTime) / (end - first);
    last = times[end] + step * (n - 1 - end);
  }
  return { step, last };
};

// the tempo of a line of clocks of `step` seconds: within the range of the field (a DAW at 400 BPM plays at 300);
// none when it isn't one (not above 0, not finite, over CLOCK_TEMPO_MAX)
const lineTempo = (step: number) => {
  const bpm = 60 / (PPQN * step);
  return bpm > 0 && bpm <= CLOCK_TEMPO_MAX ? Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm)) : null;
};

// a MIDI Clock leading the transport: the tempo the slope of the last CLOCK_WINDOW clocks (24 a quarter), the
// position the clocks since Start (or a Song Position, in 16ths: 6 clocks each). Start and Continue take the
// transport there at the next clock, Stop holds the position (the transport and the LFOs go on), each starts the
// line again; lost, the position of the next Continue is kept, another input forgets it (reset); a segment of the
// tempo is set where the transport is off the clocks (BEAT_TOLERANCE, TEMPO_TOLERANCE), once a beat at most. The
// times of the clocks are seconds of the page (performance.now(): the clock of the context stands while it is
// suspended, and its time of the output moves by quanta), those of the transport of the context (contextTime)
export const createMidiClock = (transport: ClockTransport) => {
  let times: number[] = [];
  // the position of the next clock (clocks of the song since its start: the first one after Start is 0)
  let next = 0;
  let running = false;
  // a Start or a Continue: the next clock is at `next`
  let pending = false;
  // the beat of the last segment set (null: none since the clock came)
  let followed: number | null = null;

  // the line of the clocks and its tempo (null: fewer than a beat of them, or no tempo: lineTempo)
  const clockLine = () => {
    const line = times.length >= CLOCK_MIN_TICKS ? fit(times) : null;
    const bpm = line && lineTempo(line.step);
    return line && bpm !== null ? { bpm, last: line.last } : null;
  };
  // the clock is lost (CLOCK_LOST_MS without one): its clocks, a Start or a Continue without them are forgotten,
  // the position of the next Continue is kept (where it stopped or a Song Position: a DAW stopped sends no clocks)
  const lose = () => {
    times = [];
    running = false;
    pending = false;
    followed = null;
    transport.setPlaying(false);
  };

  return {
    // the tempo of the clocks (null: fewer than a beat of them, or none: lineTempo)
    tempo: () => clockLine()?.bpm ?? null,
    tick: (time: number) => {
      times.push(time);
      if (times.length > CLOCK_WINDOW) times.shift();
      const line = clockLine();
      const bpm = line?.bpm ?? null;
      const at = transport.contextTime(line?.last ?? time);
      if (pending) {
        pending = false;
        running = true;
        followed = next / PPQN;
        next += 1;
        transport.locate(followed, at, bpm ?? transport.tempoAt(at));
        return;
      }
      // stopped: the transport goes on at the tempo of the clocks
      const beat = running ? next / PPQN : transport.beatAt(at);
      if (running) next += 1;
      if (bpm === null) return;
      if (followed !== null && beat >= followed && beat - followed < 1) return;
      const before = transport.tempoAt(at);
      const off = (Math.abs(beat - transport.beatAt(at)) * 60) / bpm;
      if (off <= BEAT_TOLERANCE && Math.abs(bpm - before) / before <= TEMPO_TOLERANCE) return;
      transport.follow({ time: at, beat, bpm });
      followed = beat;
    },
    // Start, Continue and Stop start the line again: a DAW starts its clocks again there (after a pause when it
    // sends none while stopped, or at another phase), the clocks before are not on the line of those after (its
    // lower envelope would put them a pause early); the first beat of them plays at the tempo of the transport
    start: () => {
      times = [];
      next = 0;
      pending = true;
      transport.setPlaying(true);
    },
    continue: () => {
      times = [];
      pending = true;
      transport.setPlaying(true);
    },
    stop: () => {
      times = [];
      running = false;
      pending = false;
      transport.setPlaying(false);
    },
    // a Song Position (16ths, sent while stopped): the position of the next Continue, the transport is there at
    // `at`; while running nothing
    songPosition: (sixteenths: number, at: number) => {
      if (running) return;
      next = sixteenths * (PPQN / 4);
      followed = next / PPQN;
      transport.locate(followed, transport.contextTime(at));
    },
    lose,
    // another input: nothing of the clock is kept, its position neither
    reset: () => {
      lose();
      next = 0;
    },
  };
};
