import { FxCore } from './types';

// smooths param changes, so mix, bypass and effect params don't click
export const setSmooth = (audioCtx: BaseAudioContext, param: AudioParam, value: number) =>
  param.setTargetAtTime(value, audioCtx.currentTime, 0.01);

export type FxSlot = ReturnType<typeof createFxSlot>;

// input → output (dry, always at full level, so adding or bypassing an effect keeps the dry level)
// input → send → core → wet → output (send is closed while inactive, so the core gets no new signal)
export const createFxSlot = (audioCtx: BaseAudioContext, core: FxCore) => {
  const input = audioCtx.createGain();
  const output = audioCtx.createGain();
  const wet = audioCtx.createGain();
  const send = audioCtx.createGain();

  input.connect(output);
  input.connect(send);
  send.connect(core.input);
  core.output.connect(wet);
  wet.connect(output);

  const setGain = (node: GainNode, value: number) => setSmooth(audioCtx, node.gain, value);

  return {
    input,
    output,
    wet,
    send,
    setParam: core.setParam,
    // mix is the wet level, bypassed: only the dry signal passes
    setMix: (mix: number, on: boolean) => setGain(wet, on ? mix : 0),
    // active: in the chain and not bypassed
    setActive: (active: boolean) => {
      setGain(send, active ? 1 : 0);
      core.setActive(active);
    },
    destroy: () => {
      core.destroy();
      [input, output, wet, send].forEach((node) => node.disconnect());
    },
  };
};
