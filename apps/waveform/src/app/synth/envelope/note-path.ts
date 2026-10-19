import { EnvelopeParams, envelopeLevel } from '../common/envelope/envelope-curve';

// the corners of the path of a note on the chart of an envelope (NotePath of the ui-kit): [seconds after its
// start, seconds on the chart, level], always on the line of the chart. Held: the attack and the decay to the
// sustain corner, where it stays; released `releasedAt` seconds after its start: the stages until then, then (a
// step if released before the sustain) from the sustain corner along the release line to 0
export const noteCorners = (env: EnvelopeParams, releasedAt: number | null): [number, number, number][] => {
  const { attack, hold, decay, sustain, release } = env;
  const end = attack + hold + decay;
  const held: [number, number, number][] = [
    [0, 0, 0],
    [attack, attack, 1],
    [attack + hold, attack + hold, 1],
    [end, end, sustain],
  ];
  if (releasedAt === null) return held;
  const at = Math.max(0, releasedAt);
  return [
    ...held.filter(([time]) => time < at),
    [at, Math.min(at, end), envelopeLevel(env, at)],
    [at, end, sustain],
    [at + release, end + release, 0],
  ];
};

// the time (ms on the document timeline, as performance.now()) the output plays `time` of the context at: from
// getOutputTimestamp (the time the device plays now), else (none, or zero before the context runs) from the time
// rendered now and the latencies of the context
export const outputTime = (audioCtx: AudioContext, time: number) => {
  const output = audioCtx.getOutputTimestamp?.();
  if (output?.performanceTime && output.contextTime !== undefined)
    return output.performanceTime + (time - output.contextTime) * 1000;
  const latency = (audioCtx.baseLatency || 0) + (audioCtx.outputLatency || 0);
  return performance.now() + (time - audioCtx.currentTime + latency) * 1000;
};
