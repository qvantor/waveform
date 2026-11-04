import { registrar } from 'standardized-audio-context-mock';

// the work an operation gives the main thread in the audio graph, counted on the mocks (test-setup makes
// every node and param method a jest.fn): the nodes it creates, their connections and the automation calls
// on their params. A spec compares exact counts: what a note on costs doesn't depend on the machine

const NODE_TYPES = ['GainNode', 'AudioWorkletNode', 'DelayNode', 'BiquadFilterNode'];
const AUTOMATION = [
  'setValueAtTime',
  'linearRampToValueAtTime',
  'exponentialRampToValueAtTime',
  'setTargetAtTime',
  'setValueCurveAtTime',
  'cancelScheduledValues',
  'cancelAndHoldAtTime',
] as const;

export interface AudioWork {
  nodes: number;
  connects: number;
  disconnects: number;
  automation: number;
}

type MockNode = AudioNode & {
  gain?: AudioParam;
  frequency?: AudioParam;
  Q?: AudioParam;
  delayTime?: AudioParam;
  parameters?: Map<string, AudioParam>;
};

const callCount = (method: unknown) => (method as jest.Mock | undefined)?.mock?.calls.length ?? 0;

export const graphNodes = (audioCtx: BaseAudioContext) =>
  NODE_TYPES.flatMap(
    (type) => registrar.getAudioNodes(audioCtx as never, type as never) as unknown as MockNode[]
  );

const params = (node: MockNode) => [
  ...[node.gain, node.frequency, node.Q, node.delayTime].filter((param): param is AudioParam => !!param),
  ...(node.parameters?.values() ?? []),
];

export const countWork = (audioCtx: BaseAudioContext): AudioWork => {
  const nodes = graphNodes(audioCtx);
  return {
    nodes: nodes.length,
    connects: nodes.reduce((sum, node) => sum + callCount(node.connect), 0),
    disconnects: nodes.reduce((sum, node) => sum + callCount(node.disconnect), 0),
    automation: nodes.reduce(
      (sum, node) =>
        sum +
        params(node).reduce(
          (calls, param) => calls + AUTOMATION.reduce((count, method) => count + callCount(param[method]), 0),
          0
        ),
      0
    ),
  };
};

// the work of `operation` (synchronous): the counts after it less the counts before
export const work = (audioCtx: BaseAudioContext, operation: () => void): AudioWork => {
  const before = countWork(audioCtx);
  operation();
  const after = countWork(audioCtx);
  return {
    nodes: after.nodes - before.nodes,
    connects: after.connects - before.connects,
    disconnects: after.disconnects - before.disconnects,
    automation: after.automation - before.automation,
  };
};

// the node was taken off the graph: disconnected from everything after it was last connected
export const isOff = (node: AudioNode) => {
  const { connect, disconnect } = node as unknown as Record<'connect' | 'disconnect', jest.Mock>;
  const last = (mock: jest.Mock, filter: (args: unknown[]) => boolean = () => true) =>
    Math.max(
      -1,
      ...mock.mock.calls.flatMap((args, i) => (filter(args) ? [mock.mock.invocationCallOrder[i]] : []))
    );
  return last(disconnect, (args) => args.length === 0) > last(connect);
};
