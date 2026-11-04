import { registrar } from 'standardized-audio-context-mock';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { workletLoads } from '../../../../test-utils/worklet-loads';
import { FX_MOD_PROCESSOR } from '../../common/processors';
import { createFxMod } from './fx-mod';
import { FX_MOD_LINES } from './fx-mod-params';

interface NodeStub extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
  port: AudioWorkletNode['port'] & { postMessage: jest.Mock };
  connect: jest.Mock;
  disconnect: jest.Mock;
}

// the module loads asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));

const setup = () => {
  const audioCtx = new AudioContext();
  const fxMod = createFxMod(audioCtx);
  const node = () =>
    (registrar.getAudioNodes(audioCtx as never, 'AudioWorkletNode' as never) as unknown as NodeStub[]).find(
      ({ name }) => name === FX_MOD_PROCESSOR
    );
  const messages = () => node()?.port.postMessage.mock.calls.map(([message]) => message) ?? [];
  const gain = () => audioCtx.createGain().gain;
  return { audioCtx, fxMod, node, messages, gain };
};

const route = { param: 'time', source: 1, amount: 0.4, min: 0.01, max: 1 };
const line = { routes: [route], base: 0.2, map: 'linear' as const };

describe('createFxMod', () => {
  afterEach(() => jest.useRealTimers());

  it('loads its module, a node of a channel per line and no input with the lines set meanwhile', async () => {
    const { audioCtx, fxMod, node, gain } = setup();
    const param = gain();
    fxMod.set(0, line, [param]);
    fxMod.setNote(null);
    expect(fxMod.$status.value).toBe('loading');
    await flush();
    expect(workletLoads(audioCtx.audioWorklet.addModule as jest.Mock, 'fx-mod')).toBe(1);
    expect(fxMod.$status.value).toBe('ready');
    expect(node()?.options).toMatchObject({
      numberOfInputs: 0,
      numberOfOutputs: FX_MOD_LINES,
      outputChannelCount: Array(FX_MOD_LINES).fill(1),
      processorOptions: { lines: [line, ...Array(FX_MOD_LINES - 1).fill(null)], note: null, lfos: null },
    });
    expect(node()?.connect).toHaveBeenCalledWith(param, 0);
  });

  it('connects a line to its params while it has routes, disconnects it once its offset went to 0', async () => {
    const { fxMod, node, messages, gain } = setup();
    await flush();
    jest.useFakeTimers();
    const [a, b] = [gain(), gain()];
    fxMod.set(3, line, [a, b]);
    expect(messages().at(-1)).toEqual({ line: [3, line] });
    expect(node()?.connect).toHaveBeenCalledWith(a, 3);
    expect(node()?.connect).toHaveBeenCalledWith(b, 3);
    // the params of another mode
    fxMod.set(3, line, [b]);
    expect(node()?.disconnect).toHaveBeenCalledWith(a, 3);
    fxMod.set(3, null);
    expect(messages().at(-1)).toEqual({ line: [3, null] });
    expect(node()?.disconnect).not.toHaveBeenCalledWith(b, 3);
    jest.advanceTimersByTime(100);
    expect(node()?.disconnect).toHaveBeenCalledWith(b, 3);
    // a line without routes before says nothing
    const sent = messages().length;
    fxMod.set(4, null);
    expect(messages()).toHaveLength(sent);
  });

  it('says nothing of a line set again as it is (every note gives it again); its params still follow', async () => {
    const { fxMod, node, messages, gain } = setup();
    await flush();
    const [a, b] = [gain(), gain()];
    fxMod.set(3, line, [a]);
    const sent = messages().length;
    fxMod.set(3, { ...line, routes: [{ ...route }] }, [a]);
    expect(messages()).toHaveLength(sent);
    fxMod.set(3, line, [b]);
    expect(messages()).toHaveLength(sent);
    expect(node()?.disconnect).toHaveBeenCalledWith(a, 3);
    expect(node()?.connect).toHaveBeenCalledWith(b, 3);
    fxMod.set(3, { ...line, base: 0.3 }, [b]);
    expect(messages().at(-1)).toEqual({ line: [3, { ...line, base: 0.3 }] });
  });

  it('posts the note, the routes of the knobs of the LFOs and the LFOs; a node made later starts with them', async () => {
    const { fxMod, node, messages } = setup();
    const note = { envelopes: [], start: 1, release: null };
    const knobRoutes = [{ ...route, param: 'lfo1.rate' }];
    fxMod.setNote(note);
    fxMod.setKnobRoutes(knobRoutes);
    await flush();
    expect(node()?.options.processorOptions).toMatchObject({ note, knobRoutes });
    fxMod.setNote(null);
    expect(messages()).toEqual([{ note: null }]);
  });

  it('posts the LFOs while a line has a route of one, as they are before the line; a node made later starts with them', async () => {
    const { fxMod, node, messages, gain } = setup();
    const wire = {
      mode: 0,
      delay: 0,
      rise: 0,
      smooth: 0,
      phase: 0,
      anchor: { time: 0, phase: 0, period: 0.5 },
    };
    fxMod.setLfos({ at: 0, instantly: true, lfos: [wire, wire, wire, wire] });
    fxMod.setLfos({ at: 1, lfos: [{ ...wire, delay: 1 }, wire, wire, wire] });
    await flush();
    const merged = [{ ...wire, delay: 1 }, wire, wire, wire];
    expect(node()?.options.processorOptions.lfos).toEqual({ at: 0, instantly: true, lfos: merged });
    // no line of an LFO: a state is kept, not posted
    fxMod.set(0, line, [gain()]);
    fxMod.setLfos({ at: 2, lfos: [{ ...wire, phase: 0.5 }, wire, wire, wire] });
    expect(messages()).toEqual([{ line: [0, line] }]);
    // a line of an LFO: the LFOs as they are before it, then every state; the line gone: kept again
    const lfoLine = { ...line, routes: [{ ...route, source: 4 }] };
    fxMod.set(1, lfoLine, [gain()]);
    const next = { at: 3, lfos: [{ ...wire, phase: 0.25 }, wire, wire, wire] };
    fxMod.setLfos(next);
    fxMod.set(1, null);
    fxMod.setLfos({ at: 4, lfos: [{ ...wire, phase: 0.75 }, wire, wire, wire] });
    expect(messages().slice(1)).toEqual([
      { lfos: { at: 0, instantly: true, lfos: [{ ...wire, phase: 0.5 }, wire, wire, wire] } },
      { line: [1, lfoLine] },
      { lfos: next },
      { line: [1, null] },
    ]);
  });

  it('without AudioWorklet: unsupported, every call is safe', async () => {
    withoutAudioWorklet();
    const { fxMod, gain } = setup();
    expect(fxMod.$status.value).toBe('unsupported');
    fxMod.set(0, line, [gain()]);
    fxMod.destroy();
    await flush();
  });
});
