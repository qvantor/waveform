import { curveShape, EnvelopeParams, envelopeLevel } from '../common/envelope/envelope-curve';

// the points of a curved stage on the path (the chart draws CURVE_POINTS of it: these are on its line)
const PATH_POINTS = 16;

// the corners of the path of a note on the chart of an envelope (NotePath of the ui-kit): [seconds after its
// start, seconds on the chart, level], always on the line of the chart. Held: the attack and the decay to the
// sustain corner, where it stays; released `releasedAt` seconds after its start: the stages until then, then (a
// step if released before the sustain) from the sustain corner along the release line to 0. A note that
// started the envelope again from a level (mono) starts there on the attack line: up to the top in the time of
// the attack, a point of the attack is where its level is on the line. A curved stage (`curves`) has points
// along its curve between its corners
export const noteCorners = (
  env: EnvelopeParams,
  releasedAt: number | null,
  from = 0
): [number, number, number][] => {
  const { attack, hold, decay, sustain, release, curves } = env;
  const end = attack + hold + decay;
  const k = { attack: curves?.attack ?? 0, decay: curves?.decay ?? 0, release: curves?.release ?? 0 };
  // the point of the chart's attack (0 → 1 in `attack`) at a level
  const attackX = (level: number) =>
    k.attack === 0 ? level * attack : (attack * -Math.log(1 - level * (1 - Math.exp(-k.attack)))) / k.attack;
  type Point = [number, number, number];
  const shares = Array.from({ length: PATH_POINTS - 1 }, (_, i) => (i + 1) / PATH_POINTS);
  // the points of a curved stage between two corners of the chart (from [time, x, level] to the next)
  const stagePoints = (curve: number, [time, x, level]: Point, [toTime, toX, toLevel]: Point) =>
    curve === 0
      ? []
      : shares.map(
          (share): Point => [
            time + (toTime - time) * share,
            x + (toX - x) * share,
            level + (toLevel - level) * curveShape(curve, share),
          ]
        );
  // the attack from the point of its level `from` on the chart to the top: on the chart's curve
  const attackPoints = ([, x]: Point) =>
    k.attack === 0
      ? []
      : shares.map((share): Point => {
          const chartX = x + (attack - x) * share;
          return [attack * share, chartX, curveShape(k.attack, chartX / attack)];
        });
  const start: Point = [0, attackX(from), from];
  const decayStart: Point = [attack + hold, attack + hold, 1];
  const sustainCorner: Point = [end, end, sustain];
  const held: Point[] = [
    start,
    ...attackPoints(start),
    [attack, attack, 1],
    decayStart,
    ...stagePoints(k.decay, decayStart, sustainCorner),
    sustainCorner,
  ];
  if (releasedAt === null) return held;
  const at = Math.max(0, releasedAt);
  const level = envelopeLevel(env, at, from);
  const releaseStart: Point = [at, end, sustain];
  const releaseEnd: Point = [at + release, end + release, 0];
  return [
    ...held.filter(([time]) => time < at),
    // on the chart: the point of its level on the attack, its time on the decay (the chart starts with the note)
    [at, at < attack ? attackX(level) : Math.min(at, end), level],
    releaseStart,
    ...stagePoints(k.release, releaseStart, releaseEnd),
    releaseEnd,
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
