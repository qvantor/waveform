import { AudioContext as AudioContextMock, registrar } from 'standardized-audio-context-mock';
import type {
  VoiceEvent,
  VoiceEventsMessage,
  VoiceFilterOptions,
  VoiceOptions,
  VoiceRoute,
  VoicesReportMessage,
  VoiceVelocity,
} from '../app/synth/common/wavetable/voice-options';
import {
  VOICE_PARAMETERS,
  VOICES_PROCESSOR,
  VoiceParam,
} from '../app/synth/common/wavetable/wavetable-osc-params';

// the voices of the voices node of a context as the main thread made them: each rebuilt from the events
// the engine posted to the node (a voice from its `on`), its params AudioParam mocks the events of each are
// played into (the calls and their order, the value at the current time), the routes and the filters sent to
// it (and its velocities); bends() the pitch bends of the nodes; end() and started() answer for the node as its
// processor tells them

export interface VoicesNodeStub extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
  port: AudioWorkletNode['port'] & {
    postMessage: jest.Mock;
    onmessage: ((event: { data: unknown }) => void) | null;
  };
}

export interface VoiceView {
  id: number;
  // the options of its note on, and the values of its params then
  options: VoiceOptions;
  values: Partial<Record<VoiceParam, number>>;
  // its params, the events of each played into a mock
  params: Record<VoiceParam, AudioParam>;
  // the routes, the filters and the velocities sent to it, in order
  messages: (
    | { routes: VoiceRoute[] }
    | { filter: VoiceFilterOptions | null }
    | { velocity: VoiceVelocity }
  )[];
  // the node it plays in
  node: VoicesNodeStub;
}

// the mock doesn't export AudioParamMock: its class and the class of its automation events come from a gain
// (of a context of its own: the specs count the gains of theirs)
type ParamClass = new (options: object) => AudioParam;
const probe = new AudioContextMock().createGain().gain as unknown as {
  constructor: ParamClass;
  _automationEventList: { constructor: new (value: number) => object };
};
const createParam = (context: BaseAudioContext, value: number, minValue?: number, maxValue?: number) =>
  new probe.constructor({
    automationEventList: new probe._automationEventList.constructor(value),
    deLorean: registrar.getDeLorean(context as never),
    minValue: minValue ?? -3.4028234663852886e38,
    maxValue: maxValue ?? 3.4028234663852886e38,
  });

export const voicesNodes = (context: BaseAudioContext) =>
  (
    registrar.getAudioNodes(context as never, 'AudioWorkletNode' as never) as unknown as VoicesNodeStub[]
  ).filter(({ name }) => name === VOICES_PROCESSOR);

// the events a voices node got, in order (the messages of their tasks)
export const eventsOf = (node: VoicesNodeStub) =>
  node.port.postMessage.mock.calls
    .map(([message]) => message as Partial<VoiceEventsMessage>)
    .filter((message): message is VoiceEventsMessage => Array.isArray(message.events));

// `engine.flush` sends the events of this task (a microtask would)
export const voiceEvents = (context: BaseAudioContext, engine: { flush: () => void }) => {
  const views: VoiceView[] = [];
  // the pitch bend of the voices (cents), every one sent in order
  const bends: number[] = [];
  const byId = new Map<number, VoiceView>();
  const read = new Map<VoicesNodeStub, number>();

  const play = (node: VoicesNodeStub, event: VoiceEvent) => {
    if (event.kind === 'on') {
      const params = Object.fromEntries(
        VOICE_PARAMETERS.map(({ name, defaultValue, minValue, maxValue }) => [
          name,
          createParam(context, event.params[name as VoiceParam] ?? defaultValue, minValue, maxValue),
        ])
      ) as Record<VoiceParam, AudioParam>;
      const view: VoiceView = {
        id: event.voice,
        options: event.options,
        values: event.params,
        params,
        messages: [],
        node,
      };
      views.push(view);
      byId.set(event.voice, view);
      return;
    }
    if (event.kind === 'bend') {
      bends.push(event.cents);
      return;
    }
    if (event.kind === 'routes' || event.kind === 'filter' || event.kind === 'velocity') {
      const message =
        event.kind === 'routes'
          ? { routes: event.routes }
          : event.kind === 'filter'
          ? { filter: event.filter }
          : { velocity: event.velocity };
      event.voices.forEach((id) => byId.get(id)?.messages.push(message));
      return;
    }
    const param = byId.get(event.voice)?.params[event.param];
    if (!param) return;
    const { time, value = 0, constant = 0 } = event;
    if (event.kind === 'set') param.setValueAtTime(value, time);
    else if (event.kind === 'target') param.setTargetAtTime(value, time, constant);
    else if (event.kind === 'ramp') param.exponentialRampToValueAtTime(value, time);
    else if (event.kind === 'linear') param.linearRampToValueAtTime(value, time);
    else param.cancelScheduledValues(time);
  };

  const voices = () => {
    engine.flush();
    voicesNodes(context).forEach((node) => {
      const messages = eventsOf(node);
      messages
        .slice(read.get(node) ?? 0)
        .forEach(({ events }) => events.forEach((event) => play(node, event)));
      read.set(node, messages.length);
    });
    return views;
  };

  const report = (view: VoiceView, data: VoicesReportMessage) => view.node.port.onmessage?.({ data });

  return {
    voices,
    bends: () => {
      voices();
      return bends;
    },
    // the node tells that the voice has ended, that it started at frame `started` (scheduled at `scheduled`)
    end: (view: VoiceView) => report(view, { ended: [view.id] }),
    started: (view: VoiceView, started: number, scheduled: number) =>
      report(view, { started: [[view.id, started, scheduled]] }),
  };
};

// what the main thread sends the voices nodes of a context: its messages (one a task), the voices made, the
// automation events of their params (set, target, ramp, cancel), the routes, filters and velocities of playing
// voices and the pitch bends
export interface VoiceWork {
  messages: number;
  voices: number;
  automation: number;
  changes: number;
}

const countEvents = (context: BaseAudioContext): VoiceWork => {
  const events = voicesNodes(context).flatMap((node) => eventsOf(node));
  const all = events.flatMap((message) => message.events);
  return {
    messages: events.length,
    voices: all.filter(({ kind }) => kind === 'on').length,
    automation: all.filter(({ kind }) => !['on', 'routes', 'filter', 'velocity', 'bend'].includes(kind))
      .length,
    changes: all.filter(({ kind }) => ['routes', 'filter', 'velocity', 'bend'].includes(kind)).length,
  };
};

// the events of `operation` (synchronous, a task of its own: `engine.flush` sends them as its microtask
// would)
export const voiceWork = (
  context: BaseAudioContext,
  engine: { flush: () => void },
  operation: () => void
): VoiceWork => {
  engine.flush();
  const before = countEvents(context);
  operation();
  engine.flush();
  const after = countEvents(context);
  return {
    messages: after.messages - before.messages,
    voices: after.voices - before.voices,
    automation: after.automation - before.automation,
    changes: after.changes - before.changes,
  };
};
