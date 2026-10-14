import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { FxStatus } from './types';
import { createWorkletFx } from './worklet-fx';

interface WorkletNodeStub extends AudioWorkletNode {
  port: AudioWorkletNode['port'] & { postMessage: jest.Mock };
}

// the module loads asynchronously: the node exists after the pending promises settle
const flush = () => new Promise((resolve) => setTimeout(resolve));

const setup = ({ failFirstLoad = false } = {}) => {
  const audioCtx = new AudioContext();
  if (failFirstLoad) (audioCtx.audioWorklet.addModule as jest.Mock).mockRejectedValueOnce(new Error('404'));
  const createNode = jest.fn(() => new AudioWorkletNode(audioCtx, 'test', {}) as WorkletNodeStub);
  const worklet = createWorkletFx(audioCtx, 'test', createNode);
  const statuses: FxStatus[] = [];
  worklet.$status.subscribe((status) => statuses.push(status));
  const node = (index = 0) => createNode.mock.results[index]?.value as WorkletNodeStub | undefined;
  return { audioCtx, worklet, createNode, node, statuses };
};

describe('createWorkletFx', () => {
  afterEach(() => jest.restoreAllMocks());

  it('joins input and output through the node once the module has loaded', async () => {
    const { worklet, node, statuses } = setup();
    expect(node()).toBeUndefined();
    expect(statuses).toEqual(['loading']);
    await flush();
    expect(worklet.input.connect).toHaveBeenCalledWith(node());
    expect(node()?.connect).toHaveBeenCalledWith(worklet.output);
    expect(statuses).toEqual(['loading', 'ready']);
  });

  it('posts to the node, drops the messages posted before it exists', async () => {
    const { worklet, node } = setup();
    expect(() => worklet.post({ a: 1 })).not.toThrow();
    await flush();
    worklet.post({ b: 2 });
    expect(node()?.port.postMessage.mock.calls).toEqual([[{ b: 2 }]]);
  });

  it('without AudioWorklet: unsupported at once, nothing to load, nothing throws', async () => {
    withoutAudioWorklet();
    const { worklet, createNode, statuses } = setup();
    expect(statuses).toEqual(['unsupported']);
    worklet.retry();
    worklet.post({ a: 1 });
    await flush();
    expect(statuses).toEqual(['unsupported']);
    expect(createNode).not.toHaveBeenCalled();
    expect(worklet.input.connect).not.toHaveBeenCalled();
    expect(() => worklet.destroy()).not.toThrow();
  });

  it('a module that fails to load: failed, the input goes nowhere', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { worklet, createNode, statuses } = setup({ failFirstLoad: true });
    await flush();
    expect(statuses).toEqual(['loading', 'failed']);
    expect(error).toHaveBeenCalledWith('The test worklet failed', expect.any(Error));
    expect(createNode).not.toHaveBeenCalled();
    expect(worklet.input.connect).not.toHaveBeenCalled();
  });

  it('retry loads a failed module again and creates the node', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { audioCtx, worklet, node, statuses } = setup({ failFirstLoad: true });
    await flush();
    worklet.retry();
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledTimes(2);
    await flush();
    expect(statuses).toEqual(['loading', 'failed', 'loading', 'ready']);
    expect(worklet.input.connect).toHaveBeenCalledWith(node());
  });

  it('retry does nothing while loading or ready', async () => {
    const { audioCtx, worklet, createNode, statuses } = setup();
    worklet.retry();
    await flush();
    worklet.retry();
    await flush();
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(createNode).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['loading', 'ready']);
  });

  it('a node that can not be created: failed, retry creates it again', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { worklet, createNode, node, statuses } = setup();
    createNode.mockImplementationOnce(() => {
      throw new Error('InvalidStateError');
    });
    await flush();
    expect(statuses).toEqual(['loading', 'failed']);
    worklet.retry();
    await flush();
    expect(statuses).toEqual(['loading', 'failed', 'loading', 'ready']);
    expect(worklet.input.connect).toHaveBeenCalledWith(node(1));
  });

  it('a processor error: failed, the node is dropped, retry creates a new one', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { worklet, node, statuses } = setup();
    await flush();
    const first = node();
    first?.onprocessorerror?.call(first, new Event('processorerror'));
    expect(statuses).toEqual(['loading', 'ready', 'failed']);
    expect(worklet.input.disconnect).toHaveBeenCalled();
    expect(first?.disconnect).toHaveBeenCalled();
    worklet.post({ a: 1 });
    expect(first?.port.postMessage).not.toHaveBeenCalled();

    worklet.retry();
    await flush();
    expect(statuses).toEqual(['loading', 'ready', 'failed', 'loading', 'ready']);
    expect(node(1)).not.toBe(first);
    expect(worklet.input.connect).toHaveBeenLastCalledWith(node(1));
  });

  it('destroyed before the module loads: no node, the status completes', async () => {
    const { worklet, createNode } = setup();
    const complete = jest.fn();
    worklet.$status.subscribe({ complete });
    worklet.destroy();
    await flush();
    expect(createNode).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalled();
    [worklet.input, worklet.output].forEach((item) => expect(item.disconnect).toHaveBeenCalled());
  });

  it('destroyed after a failed load: no error is reported later', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { worklet, statuses } = setup({ failFirstLoad: true });
    worklet.destroy();
    await flush();
    expect(statuses).toEqual(['loading']);
    expect(error).not.toHaveBeenCalled();
  });

  it('destroy disconnects the node', async () => {
    const { worklet, node } = setup();
    await flush();
    worklet.destroy();
    [worklet.input, worklet.output, node()].forEach((item) => expect(item?.disconnect).toHaveBeenCalled());
  });
});
