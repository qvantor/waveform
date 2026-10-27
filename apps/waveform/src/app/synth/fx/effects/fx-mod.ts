import { isEqual } from 'lodash';
import { BehaviorSubject } from 'rxjs';
import { FX_MOD_PROCESSOR } from '../../common/processors';
import { LfosState, LfoWire, mergeLfos } from '../../common/lfo/lfo-curve';
import { isWorkletSupported, loadWorklet } from './load-worklet';
import type { FxNote, FxRoute } from './fx-modulation';
import { FX_MOD_GLIDE } from './fx-mod-lines';
import { FX_MOD_LINES, FxModLine, FxModMessage, FxModOptions } from './fx-mod-params';
import type { FxStatus } from './types';

// ms after a line is gone its output is disconnected: its offset is at 0 by then (FX_MOD_GLIDE, a device buffer
// late at most)
const DISCONNECT_AFTER = FX_MOD_GLIDE * 1000 + 50;

// the node of the lines (fx-mod.worklet.ts): no input, an output of one channel per line
const NODE_OPTIONS: AudioWorkletNodeOptions = {
  numberOfInputs: 0,
  numberOfOutputs: FX_MOD_LINES,
  outputChannelCount: Array<number>(FX_MOD_LINES).fill(1),
};

const sameParams = (a: AudioParam[], b: AudioParam[]) =>
  a.length === b.length && a.every((param, i) => param === b[i]);

// the lines the knobs of the native nodes follow (the delay, the mix of every slot), one node for the fx: set()
// gives a line its routes and the params it adds to (connected only while it has routes: an a-rate input costs
// every sample, the others cost nothing), the last note, the routes of the note to the knobs of the LFOs and the
// LFOs go to it as they change. Until it is ready (it loads, failed, unsupported) no line moves a param: the knobs
// work. A node made again (retry) starts with all of them
export const createFxMod = (audioCtx: BaseAudioContext) => {
  const $status = new BehaviorSubject<FxStatus>('loading');
  let node: AudioWorkletNode | null = null;
  let destroyed = false;
  const lines: (FxModLine | null)[] = Array(FX_MOD_LINES).fill(null);
  // the params each line is connected to, the timers of the lines that are gone
  const connected: AudioParam[][] = Array.from({ length: FX_MOD_LINES }, () => []);
  const timers: (number | undefined)[] = Array(FX_MOD_LINES).fill(undefined);
  let note: FxNote | null = null;
  let knobRoutes: FxRoute[] = [];
  let lfos: LfoWire[] | null = null;

  const post = (message: FxModMessage) => node?.port.postMessage(message);
  // line `index` adds to exactly `params` (none: disconnected)
  const connect = (index: number, params: AudioParam[]) => {
    const current = connected[index];
    if (node) {
      const from = node;
      current.filter((param) => !params.includes(param)).forEach((param) => from.disconnect(param, index));
      params.filter((param) => !current.includes(param)).forEach((param) => from.connect(param, index));
    }
    connected[index] = node ? params : [];
  };

  const fail = (error: unknown) => {
    if (destroyed) return;
    console.error('The fx-mod worklet failed', error);
    const failed = node;
    node = null;
    failed?.port.postMessage({ stop: true });
    failed?.disconnect();
    connected.forEach((_, index) => (connected[index] = []));
    $status.next('failed');
  };

  // the params of each line as the knobs left them: those of the lines that have routes now
  const wanted: AudioParam[][] = Array.from({ length: FX_MOD_LINES }, () => []);

  const load = () => {
    if (!isWorkletSupported(audioCtx, 'fx-mod')) {
      $status.next('unsupported');
      return;
    }
    $status.next('loading');
    loadWorklet(audioCtx, 'fx-mod')
      .then(() => {
        if (destroyed) return;
        const processorOptions: FxModOptions = {
          lines,
          note,
          knobRoutes,
          lfos: lfos && { at: 0, instantly: true, lfos },
        };
        const current = new AudioWorkletNode(audioCtx, FX_MOD_PROCESSOR, {
          ...NODE_OPTIONS,
          processorOptions,
        });
        current.onprocessorerror = (event) => {
          if (node === current) fail(event);
        };
        node = current;
        lines.forEach((line, index) => line && connect(index, wanted[index]));
        $status.next('ready');
      })
      .catch(fail);
  };
  load();

  return {
    $status,
    retry: () => {
      if ($status.value === 'failed') load();
    },
    // line `index` follows `line`, added to `params` (null: none, its offset goes to 0, then it is disconnected)
    set: (index: number, line: FxModLine | null, params: AudioParam[] = []) => {
      // (a line without routes before: nothing to say; the same one, as every note gives it again: nothing to post,
      // its glide would start again)
      if (!line && !lines[index]) return;
      const same = !!line && isEqual(line, lines[index]);
      if (same && sameParams(wanted[index], params)) return;
      window.clearTimeout(timers[index]);
      timers[index] = undefined;
      lines[index] = line;
      if (!same) post({ line: [index, line] });
      if (line) {
        wanted[index] = params;
        connect(index, params);
        return;
      }
      wanted[index] = [];
      timers[index] = window.setTimeout(() => {
        timers[index] = undefined;
        if (!lines[index]) connect(index, []);
      }, DISCONNECT_AFTER);
    },
    setNote: (next: FxNote | null) => {
      note = next;
      post({ note });
    },
    setKnobRoutes: (routes: FxRoute[]) => {
      knobRoutes = routes;
      post({ knobRoutes });
    },
    setLfos: (state: LfosState) => {
      lfos = mergeLfos(lfos, state);
      post({ lfos: state });
    },
    destroy: () => {
      destroyed = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      post({ stop: true });
      node?.disconnect();
      node = null;
      $status.complete();
    },
  };
};
export type FxMod = ReturnType<typeof createFxMod>;
