import { mapValues } from 'lodash';
import { FX_PARAMS } from '@waveform/preset-schema';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { distortion } from './distortion';
import { DISTORTION_LATENCY, DISTORTION_PROCESSOR } from './distortion-dsp';
import { DISTORTION_MODES } from './distortion-modes';
import { WORKLETS_PATH } from './load-worklet';

interface WorkletNodeStub extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
  port: AudioWorkletNode['port'] & { postMessage: jest.Mock };
}

const DEFAULTS = mapValues(FX_PARAMS.distortion, (param) => param.default);

// the module loads asynchronously: the node exists after the pending promises settle
const flush = () => new Promise((resolve) => setTimeout(resolve));

const setup = () => {
  const audioCtx = new AudioContext();
  const createGain = jest.spyOn(audioCtx, 'createGain');
  const core = distortion.create(audioCtx);
  const [input, output] = createGain.mock.results.map(({ value }) => value as GainNode);
  // the input connects to the worklet node once it is created
  const node = () => (input.connect as jest.Mock).mock.calls[0]?.[0] as WorkletNodeStub | undefined;
  const messages = () => node()?.port.postMessage.mock.calls.map(([message]) => message);
  return { audioCtx, core, input, output, node, messages };
};

describe('distortion', () => {
  it('a mode switch over the curves, drive and level in dB, the top of the tone is open', () => {
    const { params } = distortion;
    expect(params.mode.options?.map(({ id }) => id)).toEqual(DISTORTION_MODES.map(({ id }) => id));
    expect(params.drive.formatValue?.(12)).toBe('+12.0dB');
    expect(params.level.formatValue?.(-6)).toBe('-6.0dB');
    expect(params.level.formatValue?.(0)).toBe('0.0dB');
    expect(params.tone.formatValue?.(2500)).toBe('2.5kHz');
    expect(params.tone.formatValue?.(FX_PARAMS.distortion.tone.max)).toBe('Open');
  });

  it('passes input and output gains at once, the worklet node joins them after the module loads', async () => {
    const { audioCtx, core, input, output, node } = setup();
    expect(core.input).toBe(input);
    expect(core.output).toBe(output);
    expect(node()).toBeUndefined();
    await flush();
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledWith(
      new URL(`${WORKLETS_PATH}distortion.js`, document.baseURI).href
    );
    expect(node()?.name).toBe(DISTORTION_PROCESSOR);
    expect(node()?.connect).toHaveBeenCalledWith(output);
  });

  it('reports its latency in seconds, for the dry signal of the fx slot', () => {
    const { audioCtx, core } = setup();
    expect(core.latency).toBe(DISTORTION_LATENCY / audioCtx.sampleRate);
  });

  it('is mixed linearly with the dry signal: it is the dry one reshaped, in time with it', () => {
    expect(setup().core.linearMix).toBe(true);
  });

  it('upmixes the input to stereo and outputs stereo', async () => {
    const { node } = setup();
    await flush();
    expect(node()?.options).toMatchObject({
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
  });

  it('starts the processor with the defaults', async () => {
    const { node } = setup();
    await flush();
    expect(node()?.options.processorOptions).toEqual({ params: DEFAULTS });
  });

  it('keeps the params set before the module loads, falsy ones included', async () => {
    const { core, node } = setup();
    core.setParam('drive', 0);
    core.setParam('mode', 1);
    core.setParam('level', -3);
    await flush();
    expect(node()?.options.processorOptions).toEqual({
      params: { ...DEFAULTS, drive: 0, mode: 1, level: -3 },
    });
    expect(node()?.port.postMessage).not.toHaveBeenCalled();
  });

  it('posts every changed param', async () => {
    const { core, messages } = setup();
    await flush();
    core.setParam('mode', 0);
    core.setParam('tone', 3000);
    core.setParam('level', 0);
    expect(messages()).toEqual([
      { params: { mode: 0 } },
      { params: { tone: 3000 } },
      { params: { level: 0 } },
    ]);
  });

  it('ignores unknown params', async () => {
    const { core, node, messages } = setup();
    core.setParam('decay', 1);
    await flush();
    expect(node()?.options.processorOptions.params).not.toHaveProperty('decay');
    core.setParam('fb', 0.5);
    expect(messages()).toEqual([]);
  });

  it('the active flag posts nothing: there is no tail to drain', async () => {
    const { core, messages } = setup();
    await flush();
    core.setActive(false);
    core.setActive(true);
    expect(messages()).toEqual([]);
  });

  it('destroy stops the processor and disconnects the nodes', async () => {
    const { core, input, output, node, messages } = setup();
    await flush();
    core.destroy();
    expect(messages()).toEqual([{ stop: true }]);
    [input, output, node()].forEach((item) => expect(item?.disconnect).toHaveBeenCalled());
  });

  it('destroyed before the module loads: no node is created', async () => {
    const { core, input, output, node } = setup();
    core.destroy();
    await flush();
    expect(node()).toBeUndefined();
    [input, output].forEach((item) => expect(item.disconnect).toHaveBeenCalled());
  });

  it('reports loading, then ready', async () => {
    const { core } = setup();
    expect(core.$status?.value).toBe('loading');
    await flush();
    expect(core.$status?.value).toBe('ready');
  });

  it('a retry after a failed load starts the processor with the params set meanwhile', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const audioCtx = new AudioContext();
    (audioCtx.audioWorklet.addModule as jest.Mock).mockRejectedValueOnce(new Error('404'));
    const createGain = jest.spyOn(audioCtx, 'createGain');
    const core = distortion.create(audioCtx);
    const [input, output] = createGain.mock.results.map(({ value }) => value as GainNode);
    await flush();
    expect(core.$status?.value).toBe('failed');
    expect(input.connect).not.toHaveBeenCalled();
    core.setParam('drive', 15);
    core.retry?.();
    expect(core.$status?.value).toBe('loading');
    await flush();
    expect(core.$status?.value).toBe('ready');
    const node = (input.connect as jest.Mock).mock.calls[0][0] as WorkletNodeStub;
    expect(node.connect).toHaveBeenCalledWith(output);
    expect(node.options.processorOptions).toEqual({ params: { ...DEFAULTS, drive: 15 } });
    error.mockRestore();
  });

  it('without AudioWorklet: unsupported, every call is safe', async () => {
    withoutAudioWorklet();
    const audioCtx = new AudioContext();
    let core: ReturnType<typeof distortion.create> | undefined;
    expect(() => (core = distortion.create(audioCtx))).not.toThrow();
    expect(core?.$status?.value).toBe('unsupported');
    expect(() => {
      core?.setParam('drive', 3);
      core?.setActive(false);
      core?.retry?.();
      core?.destroy();
    }).not.toThrow();
    await flush();
    expect(core?.input.connect).not.toHaveBeenCalled();
  });
});
