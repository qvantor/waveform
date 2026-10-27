import { registrar } from 'standardized-audio-context-mock';
import { LFO_DEFAULTS } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createLfos, createSynthCore } from '../../../../test-utils/models';
import { voiceEvents } from '../../../../test-utils/voice-events';
import { FREE, LFO_LEAD, LFO_STATE_INTERVAL, lfoTable, phaseAt, RETRIG } from '../lfo/lfo-curve';

// the wavetable oscillator loads its module asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));
// a second change within LFO_STATE_INTERVAL goes out after it
const interval = () => new Promise((resolve) => setTimeout(resolve, LFO_STATE_INTERVAL * 1000 + 5));

const setup = async () => {
  const synthCore = createSynthCore();
  const [{ audioCtx, wavetables }] = synthCore;
  const [model, actions] = createLfos(synthCore);
  await flush();
  // (the first state went at once: a change within LFO_STATE_INTERVAL of it would wait)
  await interval();
  const events = voiceEvents(audioCtx, wavetables);
  // a voice with a route of LFO 1: the node reads the LFOs, the states go to it
  wavetables.createVoice(
    {
      osc: [],
      start: 0,
      envelopes: [],
      envStart: 0,
      phrase: 0,
      routes: [{ source: 4, param: 'gain1', amount: 0.5, min: 0, max: 1 }],
      filter: null,
    },
    {}
  );
  const travel = (seconds: number) => registrar.getDeLorean(audioCtx as never)?.travel(seconds);
  return { model, actions, audioCtx, lfos: events.lfos, travel };
};

describe('lfos', () => {
  it('has four sines of 0.5 s, retrig, in the snapshot by their keys', async () => {
    const { model } = await setup();
    expect(Object.keys(model.$lfos.value)).toEqual(['lfo1', 'lfo2', 'lfo3', 'lfo4']);
    expect(getSnapshot()['lfo']).toEqual({
      l1: LFO_DEFAULTS,
      l2: LFO_DEFAULTS,
      l3: LFO_DEFAULTS,
      l4: LFO_DEFAULTS,
    });
  });

  it('round trips through the snapshot; a missing knob is its default, 0 is kept, odd values are left out', async () => {
    const { model, actions } = await setup();
    actions.setLfoValue('lfo2', 'rate', 0.125);
    actions.setLfoValue('lfo2', 'delay', 0);
    actions.setMode('lfo2', 'free');
    actions.setShape('lfo3', 'square');
    const snapshot = getSnapshot();
    applySnapshot({});
    expect(model.$lfos.value.lfo2).toEqual(LFO_DEFAULTS);
    applySnapshot(snapshot);
    expect(model.$lfos.value.lfo2).toEqual({ ...LFO_DEFAULTS, rate: 0.125, mode: 'free' });
    expect(model.$lfos.value.lfo3.shape).toBe('square');
    applySnapshot({
      lfo: {
        l1: { rate: 100, delay: 'x', smooth: 2, phase: 0, shape: 'noise', mode: 'env' },
        l2: null,
        l3: { points: [[0.1, 0, 0]] },
      },
    });
    expect(model.$lfos.value.lfo1).toEqual({ ...LFO_DEFAULTS, rate: 32, smooth: 0.5 });
    expect(model.$lfos.value.lfo2).toEqual(LFO_DEFAULTS);
    expect(model.$lfos.value.lfo3).toEqual(LFO_DEFAULTS);
  });

  it('keeps points of its own until a shape is chosen', async () => {
    const { model, actions } = await setup();
    const points: [number, number, number][] = [
      [0, 0, 0],
      [0.25, 1, 2],
      [1, 0, 0],
    ];
    actions.setPoints('lfo1', points);
    expect(model.$lfos.value.lfo1.points).toEqual(points);
    expect(getSnapshot()['lfo']).toMatchObject({ l1: { points } });
    actions.setShape('lfo1', 'triangle');
    expect(model.$lfos.value.lfo1).toEqual({ ...LFO_DEFAULTS, shape: 'triangle' });
    actions.setPoints('lfo1', [
      [0.5, 0, 0],
      [1, 1, 0],
    ]);
    expect(model.$lfos.value.lfo1).not.toHaveProperty('points');
  });

  it('sends the voices node every LFO at once with its table once it is ready', async () => {
    const { lfos } = await setup();
    const [first] = lfos();
    expect(first).toMatchObject({ at: 0, instantly: true });
    expect(first.lfos).toHaveLength(4);
    first.lfos.forEach((wire) => {
      expect(wire).toMatchObject({ mode: RETRIG, delay: 0, rise: 0, smooth: 0, phase: 0 });
      expect(wire.anchor).toEqual({ time: 0, phase: 0, period: 0.5 });
      expect(wire.table).toEqual(lfoTable('sine'));
    });
  });

  it('sends a change from now + 10 ms on, the table only of a shape that changed', async () => {
    const { actions, audioCtx, lfos, travel } = await setup();
    travel(1);
    const sent = lfos().length;
    actions.setMode('lfo1', 'free');
    actions.setShape('lfo2', 'saw-down');
    await interval();
    const [mode, shape] = lfos().slice(sent);
    expect(mode.at).toBe(audioCtx.currentTime + LFO_LEAD);
    expect(mode.instantly).toBeUndefined();
    expect(mode.lfos[0].mode).toBe(FREE);
    expect(mode.lfos.every((wire) => !wire.table)).toBe(true);
    expect(shape.lfos[1].table).toEqual(lfoTable('saw-down'));
    expect(shape.lfos.filter((wire) => wire.table)).toHaveLength(1);
  });

  it('a new period keeps the phase of the clock: an anchor at now + 10 ms there', async () => {
    const { model, actions, audioCtx, lfos, travel } = await setup();
    travel(1.3);
    const sent = lfos().length;
    actions.setLfoValue('lfo1', 'rate', 0.2);
    const at = audioCtx.currentTime + LFO_LEAD;
    const [event] = lfos().slice(sent);
    // 1.31 s of 0.5 s cycles
    expect(event.lfos[0].anchor.time).toBe(at);
    expect(event.lfos[0].anchor.phase).toBeCloseTo(0.62, 12);
    expect(event.lfos[0].anchor.period).toBe(0.2);
    // the others keep theirs
    expect(event.lfos[1].anchor).toEqual({ time: 0, phase: 0, period: 0.5 });
    const { anchors } = model.globals.lfo1;
    expect(phaseAt(anchors, at - 1e-9)).toBeCloseTo(phaseAt(anchors, at), 6);
    // 0.1 s later: half a cycle of 0.2 s further
    expect(model.globals.lfo1.clock(at + 0.1)).toBeCloseTo(0.12, 12);
    // and again: from where the clock is then
    travel(0.05);
    actions.setLfoValue('lfo1', 'rate', 1);
    await interval();
    const [next] = lfos().slice(sent + 1);
    expect(next.lfos[0].anchor.phase).toBeCloseTo(0.62 + 0.05 / 0.2, 12);
  });

  it('runs the LFOs on the main thread as it sends them: the knobs from their time on', async () => {
    const { model, actions, audioCtx, travel } = await setup();
    travel(2);
    actions.setLfoValue('lfo3', 'delay', 0.25);
    const at = audioCtx.currentTime + LFO_LEAD;
    expect(model.globals.lfo3.knobs(at - 0.001).delay).toBe(0);
    expect(model.globals.lfo3.knobs(at).delay).toBe(0.25);
    expect(model.$state.value?.lfos[2]).toMatchObject({ delay: 0.25, table: lfoTable('sine') });
  });
});
