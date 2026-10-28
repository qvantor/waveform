// the knobs of the fx made of native nodes (the delay, the gains of every slot) set their params: a step or a glide;
// the routes of the envelopes and the LFOs add the lines of fx-mod to them (fx-mod.ts), no automation of theirs

// the param steps to `value` at `time`
export const setParam = (param: AudioParam, value: number, time: number) => param.setValueAtTime(value, time);

// the param glides to `value` from `time` on (setTargetAtTime), from where it is then
export const glideParam = (param: AudioParam, value: number, time: number, timeConstant: number) =>
  param.setTargetAtTime(value, time, timeConstant);
