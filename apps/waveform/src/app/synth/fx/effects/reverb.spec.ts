import { mapValues, omit } from 'lodash';
import { FX_PARAMS } from '@waveform/preset-schema';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { REVERB_PROCESSOR } from '../../common/processors';
import { LfoWire, RETRIG } from '../../common/lfo/lfo-curve';
import { reverb } from './reverb';
import { REVERB_ERAS } from './reverb-era';
import { WORKLETS_PATH } from './load-worklet';

interface WorkletNodeStub extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
  port: AudioWorkletNode['port'] & { postMessage: jest.Mock };
}

const DEFAULTS = mapValues(FX_PARAMS.reverb, (param) => param.default);
const [, EIGHTIES] = REVERB_ERAS;

const ENV = { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.5, release: 0.2 };

// the module loads asynchronously: the node exists after the pending promises settle
const flush = () => new Promise((resolve) => setTimeout(resolve));

const setup = () => {
  const audioCtx = new AudioContext();
  const createGain = jest.spyOn(audioCtx, 'createGain');
  const core = reverb.create(audioCtx);
  const [input, output] = createGain.mock.results.map(({ value }) => value as GainNode);
  // the input connects to the worklet node once it is created
  const node = () => (input.connect as jest.Mock).mock.calls[0]?.[0] as WorkletNodeStub | undefined;
  const messages = () => node()?.port.postMessage.mock.calls.map(([message]) => message);
  return { audioCtx, core, input, output, node, messages };
};

describe('reverb', () => {
  it('posts the LFOs while a route of one moves a knob, as they are first; a node made later starts with them', async () => {
    const { core, node, messages } = setup();
    const wire = (change: Partial<LfoWire> = {}): LfoWire => ({
      mode: RETRIG,
      delay: 0,
      rise: 0,
      smooth: 0,
      phase: 0,
      anchor: { time: 0, phase: 0, period: 0.5 },
      ...change,
    });
    core.setLfos?.({ at: 0, instantly: true, lfos: [wire(), wire({ delay: 1 }), wire(), wire()] });
    await flush();
    const merged = [wire(), wire({ delay: 1 }), wire(), wire()];
    expect(node()?.options.processorOptions.lfos).toEqual({ at: 0, instantly: true, lfos: merged });
    core.setLfos?.({ at: 2, lfos: [wire({ phase: 0.5 }), wire(), wire(), wire()] });
    expect(messages()).toEqual([]);
    const lfo = { param: 'size', source: 5, amount: 0.5, min: 0, max: 1 };
    core.setModulation?.({ note: null, routes: [lfo] });
    const next = { at: 3, lfos: [wire({ phase: 0.25 }), wire(), wire(), wire()] };
    core.setLfos?.(next);
    expect(messages()).toEqual([
      { lfos: { at: 0, instantly: true, lfos: [wire({ phase: 0.5 }), wire(), wire(), wire()] } },
      { mod: { note: null, routes: [lfo] } },
      { lfos: next },
    ]);
  });

  it('passes input and output gains at once, the worklet node joins them after the module loads', async () => {
    const { audioCtx, core, input, output, node } = setup();
    expect(core.input).toBe(input);
    expect(core.output).toBe(output);
    expect(node()).toBeUndefined();
    await flush();
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledWith(
      new URL(`${WORKLETS_PATH}reverb.js`, document.baseURI).href
    );
    expect(node()?.name).toBe(REVERB_PROCESSOR);
    expect(node()?.connect).toHaveBeenCalledWith(output);
  });

  it('loads the module once per context', async () => {
    const audioCtx = new AudioContext();
    reverb.create(audioCtx);
    reverb.create(audioCtx);
    await flush();
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    reverb.create(new AudioContext());
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledTimes(1);
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

  it('starts the processor with the defaults, the era resolved to its input stage (80s)', async () => {
    const { node } = setup();
    await flush();
    expect(node()?.options.processorOptions).toEqual({
      params: {
        ...omit(DEFAULTS, 'era'),
        drive: EIGHTIES.drive,
        bandwidth: EIGHTIES.bandwidth,
        body: EIGHTIES.body,
      },
      active: true,
    });
  });

  it('keeps the params and the active flag set before the module loads', async () => {
    const { core, node } = setup();
    core.setParam('decay', 5);
    core.setParam('era', 0);
    core.setActive(false);
    await flush();
    expect(node()?.options.processorOptions).toMatchObject({
      params: { decay: 5, drive: 0, bandwidth: 22050, body: 0 },
      active: false,
    });
    expect(node()?.port.postMessage).not.toHaveBeenCalled();
  });

  it('posts every changed param, the era as the values of its input stage', async () => {
    const { audioCtx, core, messages } = setup();
    await flush();
    core.setParam('size', 0.8);
    core.setParam('sep', 0);
    core.setParam('era', 2);
    // the full band of the now era is nyquist
    core.setParam('era', 0);
    expect(messages()).toEqual([
      { params: { size: 0.8 } },
      { params: { sep: 0 } },
      {
        params: {
          drive: REVERB_ERAS[2].drive,
          bandwidth: REVERB_ERAS[2].bandwidth,
          body: REVERB_ERAS[2].body,
        },
      },
      { params: { drive: 0, bandwidth: audioCtx.sampleRate / 2, body: 0 } },
    ]);
  });

  it('ignores unknown params', async () => {
    const { core, node, messages } = setup();
    core.setParam('time', 1);
    await flush();
    expect(node()?.options.processorOptions.params).not.toHaveProperty('time');
    core.setParam('fb', 0.5);
    expect(messages()).toEqual([]);
  });

  it('posts the active flag', async () => {
    const { core, messages } = setup();
    await flush();
    core.setActive(false);
    core.setActive(true);
    expect(messages()).toEqual([{ active: false }, { active: true }]);
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

  it('a module that fails to load leaves the reverb silent and failed', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const audioCtx = new AudioContext();
    (audioCtx.audioWorklet.addModule as jest.Mock).mockRejectedValueOnce(new Error('404'));
    const createGain = jest.spyOn(audioCtx, 'createGain');
    const core = reverb.create(audioCtx);
    await flush();
    expect(createGain.mock.results[0].value.connect).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    expect(core.$status?.value).toBe('failed');
    expect(() => core.setParam('decay', 3)).not.toThrow();
    error.mockRestore();
  });

  it('a retry after a failed load starts the processor with the params set meanwhile', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const audioCtx = new AudioContext();
    (audioCtx.audioWorklet.addModule as jest.Mock).mockRejectedValueOnce(new Error('404'));
    const createGain = jest.spyOn(audioCtx, 'createGain');
    const core = reverb.create(audioCtx);
    const [input, output] = createGain.mock.results.map(({ value }) => value as GainNode);
    await flush();
    core.setParam('decay', 7);
    core.setActive(false);
    core.retry?.();
    expect(core.$status?.value).toBe('loading');
    await flush();
    expect(core.$status?.value).toBe('ready');
    const node = (input.connect as jest.Mock).mock.calls[0][0] as WorkletNodeStub;
    expect(node.connect).toHaveBeenCalledWith(output);
    expect(node.options.processorOptions).toMatchObject({ params: { decay: 7 }, active: false });
    error.mockRestore();
  });

  it('without AudioWorklet: unsupported, every call is safe', async () => {
    withoutAudioWorklet();
    const audioCtx = new AudioContext();
    let core: ReturnType<typeof reverb.create> | undefined;
    expect(() => (core = reverb.create(audioCtx))).not.toThrow();
    expect(core?.$status?.value).toBe('unsupported');
    expect(() => {
      core?.setParam('decay', 3);
      core?.setActive(false);
      core?.retry?.();
      core?.destroy();
    }).not.toThrow();
    await flush();
    expect(core?.input.connect).not.toHaveBeenCalled();
  });

  it('posts the modulation of its knobs: the worklet moves them once per block', async () => {
    const { core, messages } = setup();
    await flush();
    const mod = {
      note: { envelopes: [ENV, ENV, ENV], start: 1, release: null },
      routes: [{ param: 'decay', source: 1, amount: 2, min: 0.1, max: 20, scale: 'log' as const }],
    };
    core.setModulation(mod);
    core.setModulation(null);
    expect(messages()?.slice(-2)).toEqual([{ mod }, { mod: null }]);
  });
});
