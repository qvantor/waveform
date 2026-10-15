import { BehaviorSubject } from 'rxjs';
import { FxStatus } from './types';
import { isWorkletSupported, loadWorklet } from './load-worklet';
import type { StopMessage } from './stereo-processor';

// the node of a stereo processor (stereo-processor.ts): a mono input is upmixed to both channels
export const STEREO_WORKLET_OPTIONS: AudioWorkletNodeOptions = {
  numberOfInputs: 1,
  numberOfOutputs: 1,
  outputChannelCount: [2],
  channelCount: 2,
  channelCountMode: 'explicit',
  channelInterpretation: 'speakers',
};

// the common part of an effect that runs in an audio worklet: input → node → output once the module
// `name` (assets/worklets/<name>.js) has loaded. $status tells the user (the fx model, the master limiter)
// whether the node can be used: until it exists, or when the browser has no AudioWorklet or the module
// failed, the input goes nowhere and the fx model keeps the effect out of the chain. retry() loads a
// failed effect again. The effect keeps its params itself and passes them to the node it creates in
// createNode (processorOptions), messages posted before the node exists are dropped. destroy() stops the
// processor, so the node can be collected
export const createWorkletFx = (
  audioCtx: BaseAudioContext,
  name: string,
  createNode: () => AudioWorkletNode
) => {
  const input = audioCtx.createGain();
  const output = audioCtx.createGain();
  const $status = new BehaviorSubject<FxStatus>('loading');
  let destroyed = false;
  let node: AudioWorkletNode | undefined;

  const fail = (error: unknown) => {
    if (destroyed) return;
    console.error(`The ${name} worklet failed`, error);
    input.disconnect();
    node?.disconnect();
    node = undefined;
    $status.next('failed');
  };

  const load = () => {
    if (!isWorkletSupported(audioCtx)) {
      $status.next('unsupported');
      return;
    }
    $status.next('loading');
    loadWorklet(audioCtx, name)
      .then(() => {
        if (destroyed) return;
        const current = createNode();
        node = current;
        // the processor threw: it outputs silence from now on, a retry creates a new one; a node dropped
        // earlier (failed, then retried) must not fail the current one
        current.onprocessorerror = (event) => {
          if (node === current) fail(event);
        };
        input.connect(current).connect(output);
        $status.next('ready');
      })
      .catch(fail);
  };
  load();

  return {
    input,
    output,
    $status,
    retry: () => {
      if ($status.value === 'failed') load();
    },
    post: (message: unknown) => node?.port.postMessage(message),
    destroy: () => {
      destroyed = true;
      const stop: StopMessage = { stop: true };
      node?.port.postMessage(stop);
      node?.disconnect();
      input.disconnect();
      output.disconnect();
      $status.complete();
    },
  };
};
