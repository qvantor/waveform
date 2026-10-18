import { Subscription } from 'rxjs';
import { normalizePreset } from '@waveform/preset-schema';
import { applySnapshot } from '../app';
import type {
  useAdsrEnvelope,
  useInputController,
  useOscillator1,
  useOscillator2,
  useSynth,
  useSynthCore,
} from '../synth/common/modules';
import type { VoiceStart } from '../synth/common/modules/synth';
import type { WavetableEngineStats } from '../synth/common/wavetable/wavetable-engine';
import type { useFilter } from '../synth/filter/modules';
import type { FxStatus } from '../synth/fx/effects';
import type { useFx } from '../synth/fx/modules';
import type { usePresets } from '../presets/modules/presets';
import { noteToString, stringToNote } from '../synth/services';
import { matchNotes, NoteLatency, NoteRecord, noteLatency, PressRecord, ReleaseRecord } from './latency';
import { PROBE_PROCESSOR, ProbeOnsetMessage, ProbeOptions } from './probe-dsp';

// the test hook of the perf build (window.__waveformPerf, see scripts/bench-perf): the runner drives the synth
// through it and reads what the browser can't tell it (the voices, the tables, the timing of the notes)

export interface PerfModels {
  synthCore: ReturnType<typeof useSynthCore>;
  inputController: ReturnType<typeof useInputController>;
  adsr: ReturnType<typeof useAdsrEnvelope>;
  osc1: ReturnType<typeof useOscillator1>;
  osc2: ReturnType<typeof useOscillator2>;
  filter: ReturnType<typeof useFilter>;
  fx: ReturnType<typeof useFx>;
  synth: ReturnType<typeof useSynth>;
  presets: ReturnType<typeof usePresets>;
}

// a step of a script, `at` ms after its start: a note through the input controller ('A4')
export interface PerfStep {
  at: number;
  note: string;
  on: boolean;
}

export interface PerfStats {
  // performance.now() of the read
  at: number;
  context: { state: AudioContextState; sampleRate: number; currentTime: number };
  engine: WavetableEngineStats | null;
}

export type TracedNote = NoteRecord & NoteLatency;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createPerfApi = (models: PerfModels) => {
  const [core] = models.synthCore;
  const { audioCtx, wavetables, masterLimiter } = core;
  const [, input] = models.inputController;
  const oscillators = { osc1: models.osc1, osc2: models.osc2 };
  // the scripts run in the page (the notes of a chord at once); a new generation stops the running ones
  let generation = 0;

  const statuses = () => ({
    wavetables: wavetables.$status.value,
    limiter: masterLimiter.$status.value,
    fx: models.fx[0].$status.value as Record<string, FxStatus>,
  });
  const loading = () => Object.values(oscillators).some(([osc]) => osc.$waveTableLoading.value);

  const stats = async (): Promise<PerfStats> => {
    const engine = await wavetables.stats();
    return {
      at: performance.now(),
      context: { state: audioCtx.state, sampleRate: audioCtx.sampleRate, currentTime: audioCtx.currentTime },
      engine,
    };
  };

  // ready to play what the state says: the oscillator ready, the tables loaded and in the store, the limiter
  // and the effects out of loading
  const settled = () => {
    const { wavetables: status, limiter, fx } = statuses();
    return (
      status === 'ready' &&
      !loading() &&
      wavetables.pending().length === 0 &&
      limiter !== 'loading' &&
      Object.values(fx).every((value) => value !== 'loading')
    );
  };
  const ready = async (timeout = 30000) => {
    const begin = performance.now();
    for (;;) {
      const { wavetables: status } = statuses();
      if (status === 'unsupported' || status === 'failed')
        throw new Error(`The wavetable oscillator is ${status}`);
      if (settled()) return stats();
      if (performance.now() - begin > timeout) {
        const state = { ...statuses(), loading: loading(), pending: wavetables.pending() };
        throw new Error(`Not ready in ${timeout} ms: ${JSON.stringify(state)}`);
      }
      await sleep(20);
    }
  };

  // a snapshot of every model (missing sections are the defaults), as a preset is applied; the runner serves
  // no presets API, so no popular preset can be applied over it
  const apply = (snapshot: unknown, timeout?: number) => {
    applySnapshot(normalizePreset(snapshot));
    return ready(timeout);
  };

  const releaseAll = () =>
    Object.entries(models.inputController[0].$pressed.value).forEach(([octave, notes]) =>
      notes.forEach((note) => input.onRelease([Number(octave), note]))
    );
  const runStep = ({ note, on }: PerfStep) => (on ? input.onPress : input.onRelease)(stringToNote(note));

  const run = async (steps: PerfStep[]) => {
    const own = generation;
    const sorted = [...steps].sort((a, b) => a.at - b.at);
    const begin = performance.now();
    let next = 0;
    while (next < sorted.length && own === generation) {
      const wait = sorted[next].at - (performance.now() - begin);
      if (wait > 0) await sleep(wait);
      if (own !== generation) break;
      // every due step in one task: a chord is one
      const elapsed = performance.now() - begin;
      while (next < sorted.length && sorted[next].at <= elapsed) runStep(sorted[next++]);
    }
  };
  const stopRuns = () => generation++;

  // the probe of the onsets (probe.worklet.ts, served by the runner): input 0 the voices (preGain, before the
  // filter and the effects), 1 the output (after the limiter); the core disconnects preGain whenever its mid
  // nodes change, the probe connects it again
  let probe: AudioWorkletNode | null = null;
  let tap: Subscription | null = null;
  let onsets: ProbeOnsetMessage[] = [];
  // one probe however many installs: one before the module has loaded shares the first; a removal meanwhile
  // (a new generation) drops the install
  let installing: Promise<void> | null = null;
  let probeGeneration = 0;
  const addProbe = async (url: string, options: Partial<ProbeOptions>, own: number) => {
    await audioCtx.audioWorklet.addModule(url);
    if (own !== probeGeneration) return;
    const node = new AudioWorkletNode(audioCtx, PROBE_PROCESSOR, {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: options,
    });
    node.port.onmessage = ({ data }: MessageEvent<ProbeOnsetMessage>) => onsets.push(data);
    core.output.connect(node, 0, 1);
    node.connect(audioCtx.destination);
    tap = core.$midNodes.subscribe(() => core.preGain.connect(node, 0, 0));
    probe = node;
  };
  const installProbe = (url: string, options: Partial<ProbeOptions> = {}) => {
    installing ??= addProbe(url, options, probeGeneration).catch((error) => {
      installing = null;
      throw error;
    });
    return installing;
  };
  const removeProbe = () => {
    probeGeneration++;
    installing = null;
    if (!probe) return;
    tap?.unsubscribe();
    probe.port.postMessage({ stop: true });
    core.preGain.disconnect(probe);
    core.output.disconnect(probe);
    probe.disconnect();
    probe = null;
  };

  // the timing of the notes: the input event of each (window.event while the note on runs: a key), the moment a
  // capture listener got it, the start of its voice, the probe's onsets
  let tracing: Subscription | null = null;
  let presses: PressRecord[] = [];
  let releases: ReleaseRecord[] = [];
  let starts: VoiceStart[] = [];
  const handled = new WeakMap<Event, number>();
  const capture = (event: Event) => handled.set(event, performance.now());
  const CAPTURED = ['keydown', 'keyup'];
  // the time stamp of an event on the clock of performance.now(): jsdom stamps events from the epoch; one that is
  // off by an hour on both clocks is the moment the capture listener got the event (estimated)
  const HOUR = 3.6e6;
  const eventTime = () => {
    const event = window.event;
    if (!event) return { event: null, handled: null };
    const captured = handled.get(event) ?? null;
    const now = performance.now();
    const epoch = event.timeStamp - performance.timeOrigin;
    const timeStamp =
      Math.abs(event.timeStamp - now) < HOUR ? event.timeStamp : Math.abs(epoch - now) < HOUR ? epoch : null;
    return {
      event: { type: event.type, timeStamp: timeStamp ?? captured ?? now, estimated: timeStamp === null },
      handled: captured,
    };
  };
  const stopTrace = () => {
    tracing?.unsubscribe();
    tracing = null;
    CAPTURED.forEach((type) => window.removeEventListener(type, capture, true));
  };
  const startTrace = () => {
    stopTrace();
    presses = [];
    releases = [];
    starts = [];
    onsets = [];
    CAPTURED.forEach((type) => window.addEventListener(type, capture, true));
    const [{ $onPress, $onRelease }] = models.inputController;
    tracing = new Subscription();
    tracing.add(models.synth[0].$voiceStarts.subscribe((start) => starts.push(start)));
    // after the synth's own subscriptions: `at` is after its note on
    tracing.add(
      $onPress.subscribe((note) => {
        const output = audioCtx.getOutputTimestamp?.();
        presses.push({
          note: noteToString(note),
          ...eventTime(),
          at: performance.now(),
          contextTime: audioCtx.currentTime,
          lost: wavetables.$status.value !== 'ready',
          state: audioCtx.state,
          output: output?.performanceTime
            ? { contextTime: output.contextTime ?? 0, performanceTime: output.performanceTime }
            : null,
        });
      })
    );
    tracing.add(
      $onRelease.subscribe((note) =>
        releases.push({
          note: noteToString(note),
          ...eventTime(),
          at: performance.now(),
          contextTime: audioCtx.currentTime,
        })
      )
    );
  };
  // the notes traced so far (their voices post their starts a block or two after the note on: the runner
  // waits before it stops)
  const takeTrace = () => {
    stopTrace();
    const { sampleRate } = audioCtx;
    const notes: TracedNote[] = matchNotes(presses, starts, onsets, sampleRate).map((record) => ({
      ...record,
      ...noteLatency(record, sampleRate),
    }));
    return { notes, releases, onsets };
  };

  return {
    models,
    ready,
    apply,
    releaseAll,
    run,
    stopRuns,
    stats,
    trace: { start: startTrace, stop: takeTrace },
    probe: { install: installProbe },
    destroy: () => {
      stopRuns();
      stopTrace();
      removeProbe();
    },
  };
};

export type PerfApi = ReturnType<typeof createPerfApi>;

declare global {
  interface Window {
    __waveformPerf?: PerfApi;
  }
}
