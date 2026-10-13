import { FxCore } from './types';

// smooths param changes, so mix, bypass and effect params don't click
export const setSmooth = (audioCtx: BaseAudioContext, param: AudioParam, value: number) =>
  param.setTargetAtTime(value, audioCtx.currentTime, 0.01);

export type FxSlot = ReturnType<typeof createFxSlot>;

// input → dry → output (mix: dry at full level up to 0.5, wet at full level from 0.5; bypassed: only dry)
// input → send → core → wet → output (send is closed while inactive, so the core gets no new signal)
export const createFxSlot = (audioCtx: BaseAudioContext, core: FxCore) => {
  const input = audioCtx.createGain();
  const output = audioCtx.createGain();
  const dry = audioCtx.createGain();
  const wet = audioCtx.createGain();
  const send = audioCtx.createGain();

  input.connect(dry);
  dry.connect(output);
  input.connect(send);
  send.connect(core.input);
  core.output.connect(wet);
  wet.connect(output);
  // closed until the fx model activates the slot and sets the mix
  send.gain.setValueAtTime(0, audioCtx.currentTime);
  wet.gain.setValueAtTime(0, audioCtx.currentTime);

  const setGain = (node: GainNode, value: number) => setSmooth(audioCtx, node.gain, value);

  return {
    input,
    output,
    dry,
    wet,
    send,
    setParam: core.setParam,
    // mix 0: only dry, 0.5: dry and wet both at full level, 1: only wet; bypassed: only the dry signal passes
    setMix: (mix: number, on: boolean) => {
      setGain(dry, on ? Math.min(1, 2 * (1 - mix)) : 1);
      setGain(wet, on ? Math.min(1, 2 * mix) : 0);
    },
    // active: in the chain and not bypassed
    setActive: (active: boolean) => {
      setGain(send, active ? 1 : 0);
      core.setActive(active);
    },
    destroy: () => {
      core.destroy();
      [input, output, dry, wet, send].forEach((node) => node.disconnect());
    },
  };
};
