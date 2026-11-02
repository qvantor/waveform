// the time stamp of an event (ms) on the clock of performance.now(), null if it is on neither: jsdom stamps events
// from the epoch, a browser from the time origin of the page
const HOUR = 3.6e6;
export const eventTime = (timeStamp: number, now = performance.now()) => {
  if (Math.abs(timeStamp - now) < HOUR) return timeStamp;
  const epoch = timeStamp - performance.timeOrigin;
  return Math.abs(epoch - now) < HOUR ? epoch : null;
};

// the time of the context the output plays at `ms` (on the clock of performance.now()): from getOutputTimestamp
// (the time the device plays now), else (none, or zero before the context runs) from the time rendered now and
// the latencies of the context; outputTime of the envelope dot the other way round
export const contextTimeAt = (audioCtx: BaseAudioContext, ms: number) => {
  const context = audioCtx as BaseAudioContext & Partial<Pick<AudioContext, 'baseLatency' | 'outputLatency'>>;
  const output = (audioCtx as Partial<Pick<AudioContext, 'getOutputTimestamp'>>).getOutputTimestamp?.();
  if (output?.performanceTime && output.contextTime !== undefined)
    return output.contextTime + (ms - output.performanceTime) / 1000;
  const latency = (context.baseLatency || 0) + (context.outputLatency || 0);
  return audioCtx.currentTime - latency + (ms - performance.now()) / 1000;
};

// ms of the age of a message past which its time stamp is no time of its own
const MESSAGE_AGE = 1000;
// the time a message came at (ms, on the clock of performance.now()): its time stamp where it is one (not later than
// now, at most MESSAGE_AGE ago), else now: Chrome stamps a MIDI message 0
export const messageTime = (timeStamp: number, now = performance.now()) => {
  const stamped = eventTime(timeStamp, now);
  return stamped !== null && stamped > 0 && stamped <= now && now - stamped <= MESSAGE_AGE ? stamped : now;
};
