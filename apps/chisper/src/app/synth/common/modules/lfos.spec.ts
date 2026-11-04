import { registrar } from 'standardized-audio-context-mock';
import { divisionIndex, LFO_DEFAULTS, rateDivisions, TEMPO_DIVISIONS } from '@chisper/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createLfos, createSynthCore, createTransport } from '../../../../test-utils/models';
import { voiceEvents } from '../../../../test-utils/voice-events';
import { FREE, LFO_LEAD, LFO_STATE_INTERVAL, lfoTable, phaseAt, RETRIG } from '../lfo/lfo-curve';
import { lfoDivision, rateStepsAt } from './lfos';

// the wavetable oscillator loads its module asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));
// a second change within LFO_STATE_INTERVAL goes out after it
const interval = () => new Promise((resolve) => setTimeout(resolve, LFO_STATE_INTERVAL * 1000 + 5));

const setup = async () => {
  const synthCore = createSynthCore();
  const [{ audioCtx, wavetables }] = synthCore;
  const transport = createTransport(synthCore);
  const [model, actions] = createLfos(synthCore, transport);
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
  return { model, actions, audioCtx, lfos: events.lfos, travel, transport };
};

const at = (id: string) => divisionIndex(id);

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

  describe('in BPM', () => {
    it('takes the divisions nearest to its seconds at the tempo, their seconds back in HZ', async () => {
      const { model, actions } = await setup();
      actions.setLfoValue('lfo1', 'rate', 0.2);
      actions.setLfoValue('lfo1', 'rise', 1.1);
      actions.setBpm('lfo1', true);
      // 0.4 quarters at 120: 1/8; no delay: Off; 2.2 quarters: 1/2
      expect(model.$lfos.value.lfo1).toMatchObject({
        bpm: true,
        div: at('1/8'),
        delayDiv: 0,
        riseDiv: at('1/2'),
      });
      actions.setBpm('lfo1', false);
      expect(model.$lfos.value.lfo1).toMatchObject({ bpm: false, rate: 0.25, delay: 0, rise: 1 });
    });

    it('keeps the seconds of HZ within the ranges of its knobs', async () => {
      const { model, actions, transport } = await setup();
      transport[1].setBpm(20);
      actions.setBpm('lfo1', true);
      actions.setDivision('lfo1', 'rate', at('32 bar'));
      actions.setDivision('lfo1', 'delay', at('32 bar'));
      actions.setBpm('lfo1', false);
      expect(model.$lfos.value.lfo1).toMatchObject({ rate: 32, delay: 32 });
    });

    it('plays the seconds of its divisions at the tempo', async () => {
      const { actions, lfos } = await setup();
      actions.setBpm('lfo1', true);
      await interval();
      actions.setDivision('lfo1', 'delay', at('1/8'));
      actions.setDivision('lfo1', 'rise', at('1 bar'));
      await interval();
      expect(lfos().at(-1)?.lfos[0]).toMatchObject({ delay: 0.25, rise: 2, anchor: { period: 0.5 } });
    });

    it('steps Rate at the tempo through the divisions of 10 ms at least, the same steps as the same array', () => {
      const ids = (steps: number[]) => steps.map((division) => TEMPO_DIVISIONS[division].id);
      const straight = { trip: false, dot: false };
      const triplets = { trip: true, dot: false };
      // 1/256 at 120: 7.8 ms, 1/256T 5.2 ms
      expect(ids(rateStepsAt(straight, 120)).slice(0, 2)).toEqual(['1/128', '1/64']);
      expect(ids(rateStepsAt(triplets, 120)).slice(0, 2)).toEqual(['1/128T', '1/128']);
      // 1/256 is 10 ms at 93.75; 1/128 at 187.5 (to the rounding)
      expect(ids(rateStepsAt(straight, 93.75))[0]).toBe('1/256');
      expect(ids(rateStepsAt(straight, 187.5))[0]).toBe('1/128');
      expect(ids(rateStepsAt(straight, 300))[0]).toBe('1/64');
      expect(rateStepsAt(straight, 20)).toEqual(rateDivisions(false, false));
      expect(rateStepsAt(straight, 120)).toBe(rateStepsAt(straight, 150));
      expect(rateStepsAt(straight, 120)).not.toBe(rateStepsAt(triplets, 120));
    });

    it('plays a division shorter than 10 ms at the tempo as the shortest of its steps there, keeps its own', async () => {
      const { model, actions, lfos, transport } = await setup();
      actions.setBpm('lfo1', true);
      actions.setDivision('lfo1', 'rate', at('1/256'));
      await interval();
      // 1/128 at 120: 15.6 ms
      expect(lfos().at(-1)?.lfos[0].anchor.period).toBe(0.015625);
      expect(model.$lfos.value.lfo1.div).toBe(at('1/256'));
      expect(lfoDivision(model.$lfos.value.lfo1, 120)).toBe(at('1/128'));
      actions.setTrip('lfo1', true);
      await interval();
      // 1/128T: 10.4 ms
      expect(lfos().at(-1)?.lfos[0].anchor.period).toBeCloseTo(0.0104167, 6);
      transport[1].setBpm(300);
      await interval();
      // 1/64 at 300: 12.5 ms
      expect(lfos().at(-1)?.lfos[0].anchor.period).toBe(0.0125);
      // a slower tempo plays it again: 1/256 at 60
      transport[1].setBpm(60);
      await interval();
      expect(lfos().at(-1)?.lfos[0].anchor.period).toBe(0.015625);
      expect(model.$lfos.value.lfo1.div).toBe(at('1/256'));
    });

    it('free with HOST: a division shorter than 10 ms on the grid of the one it plays, no step at a new state', async () => {
      const { model, actions, lfos, travel, transport } = await setup();
      actions.setMode('lfo1', 'free');
      actions.setBpm('lfo1', true);
      actions.setDivision('lfo1', 'rate', at('1/256'));
      await interval();
      travel(1.3);
      actions.setLfoValue('lfo1', 'smooth', 0.1);
      await interval();
      const [before, after] = lfos().slice(-2);
      expect(before.lfos[0].anchor.period).toBe(0.015625);
      // the same anchor: the clock goes on
      expect(after.lfos[0].anchor).toEqual(before.lfos[0].anchor);
      // on the grid of 1/128 (1/32 of a quarter)
      const time = after.at + 0.01;
      expect(model.globals.lfo1.clock(time)).toBeCloseTo((transport[0].beatAt(time) * 32) % 1, 9);
    });

    it('takes the division of Rate nearest to its seconds of those at the tempo', async () => {
      const { model, actions } = await setup();
      actions.setLfoValue('lfo1', 'rate', 0.01);
      actions.setBpm('lfo1', true);
      // 10 ms at 120: 1/256 is nearer (7.8 ms) but shorter than 10 ms
      expect(model.$lfos.value.lfo1.div).toBe(at('1/128'));
    });

    it('steps through the straight divisions, with TRIP and DOT the triplets and the dotted ones', async () => {
      const { model, actions } = await setup();
      actions.setDivision('lfo1', 'rate', at('1/8T'));
      expect(model.$lfos.value.lfo1.div).toBe(at('1/8'));
      actions.setTrip('lfo1', true);
      actions.setDivision('lfo1', 'rate', at('1/8T'));
      expect(model.$lfos.value.lfo1.div).toBe(at('1/8T'));
      actions.setDot('lfo1', true);
      actions.setTrip('lfo1', false);
      expect(model.$lfos.value.lfo1).toMatchObject({ trip: false, dot: true, div: at('1/8') });
      actions.setDivision('lfo1', 'delay', at('1/8D'));
      expect(model.$lfos.value.lfo1.delayDiv).toBe(at('1/8'));
    });

    it('free with HOST: on the grid of the beats after a new tempo', async () => {
      const { model, actions, lfos, travel, transport, audioCtx } = await setup();
      actions.setMode('lfo1', 'free');
      actions.setBpm('lfo1', true);
      await interval();
      travel(1.3);
      const sent = lfos().length;
      transport[1].setBpm(60);
      const time = audioCtx.currentTime + LFO_LEAD;
      const [state] = lfos().slice(sent);
      expect(state.at).toBe(time);
      // beat 2.62 of quarters, a cycle a beat from now on
      expect(state.lfos[0].anchor).toEqual({ time, phase: expect.closeTo(0.62, 12), period: 1 });
      expect(model.globals.lfo1.clock(time + 0.5)).toBeCloseTo(0.12, 12);
      expect(model.globals.lfo1.clock(time + 0.5)).toBeCloseTo(transport[0].beatAt(time + 0.5) % 1, 12);
      // the others play in HZ: theirs stay
      expect(state.lfos[1].anchor).toEqual({ time: 0, phase: 0, period: 0.5 });
    });

    it('free with HOST: a new Rate steps the phase onto its grid', async () => {
      const { actions, lfos, travel, audioCtx } = await setup();
      actions.setMode('lfo1', 'free');
      actions.setBpm('lfo1', true);
      await interval();
      travel(1.3);
      actions.setDivision('lfo1', 'rate', at('1 bar'));
      // (after the change of BPM that went last)
      await interval();
      const time = audioCtx.currentTime + LFO_LEAD;
      // beat 2.62 of a bar: 0.655, not the 0.62 of the clock of 1/4
      expect(lfos().at(-1)?.lfos[0].anchor).toEqual({ time, phase: expect.closeTo(0.655, 12), period: 2 });
    });

    it('free without HOST: a new Rate and a new tempo keep the phase', async () => {
      const { model, actions, lfos, travel, transport, audioCtx } = await setup();
      actions.setMode('lfo1', 'free');
      actions.setHost('lfo1', false);
      actions.setBpm('lfo1', true);
      await interval();
      travel(1.3);
      actions.setDivision('lfo1', 'rate', at('1 bar'));
      // (after the change of BPM that went last)
      await interval();
      const time = audioCtx.currentTime + LFO_LEAD;
      expect(lfos().at(-1)?.lfos[0].anchor).toEqual({ time, phase: expect.closeTo(0.62, 12), period: 2 });
      travel(0.5);
      await interval();
      transport[1].setBpm(60);
      const next = audioCtx.currentTime + LFO_LEAD;
      expect(lfos().at(-1)?.lfos[0].anchor).toEqual({
        time: next,
        phase: expect.closeTo(0.62 + 0.5 / 2, 12),
        period: 4,
      });
      const { anchors } = model.globals.lfo1;
      expect(phaseAt(anchors, next + 1)).toBeCloseTo(0.87 + 0.25 - 1, 12);
    });

    it('retrig: a new tempo is a new period of the clock, the phase goes on (HOST changes nothing)', async () => {
      const { actions, lfos, travel, transport, audioCtx } = await setup();
      actions.setBpm('lfo1', true);
      await interval();
      travel(1.3);
      transport[1].setBpm(60);
      const time = audioCtx.currentTime + LFO_LEAD;
      expect(lfos().at(-1)?.lfos[0].anchor).toEqual({ time, phase: expect.closeTo(0.62, 12), period: 1 });
    });

    it('HZ with HOST: free, its phase from the position of the transport where it moves', async () => {
      const { actions, lfos, travel, transport, audioCtx } = await setup();
      actions.setMode('lfo1', 'free');
      await interval();
      travel(1.3);
      const sent = lfos().length;
      // beat 1.5 at 120: 0.75 s, a cycle and a half of 0.5 s
      transport[1].locate(1.5, audioCtx.currentTime + 0.1);
      const [state] = lfos().slice(sent);
      expect(state.at).toBeCloseTo(1.4, 12);
      expect(state.lfos[0].anchor).toEqual({ time: state.at, phase: expect.closeTo(0.5, 12), period: 0.5 });
      // retrig: nothing moves it
      expect(state.lfos[1].anchor).toEqual({ time: 0, phase: 0, period: 0.5 });
    });

    it('sends nothing for a new tempo without an LFO in BPM, nor where the transport moves without HOST', async () => {
      const { actions, lfos, transport, audioCtx } = await setup();
      const sent = lfos().length;
      transport[1].setBpm(90);
      actions.setHost('lfo1', false);
      await interval();
      const after = lfos().length;
      transport[1].locate(0, audioCtx.currentTime);
      expect(lfos().length).toBe(after);
      expect(after).toBe(sent + 1);
    });

    it('bounds the routes to its knobs by its divisions at the tempo', async () => {
      const { model, actions, transport } = await setup();
      expect(model.$ranges.value).toEqual({});
      actions.setBpm('lfo2', true);
      // 32 bar at 120: 64 s; 1/128: 15.6 ms (1/256 is shorter than 10 ms there)
      expect(model.$ranges.value).toEqual({
        'lfo2.rate': [1 / 64, 64],
        'lfo2.delay': [0, 64],
        'lfo2.rise': [0, 64],
      });
      transport[1].setBpm(60);
      expect(model.$ranges.value['lfo2.rate']).toEqual([1 / 128, 64]);
    });

    it('round trips through the snapshot; a missing field is its default, false is kept', async () => {
      const { model, actions } = await setup();
      actions.setBpm('lfo2', true);
      actions.setHost('lfo2', false);
      actions.setTrip('lfo2', true);
      actions.setDivision('lfo2', 'rate', at('1/16T'));
      actions.setDivision('lfo2', 'rise', at('2 bar'));
      const snapshot = getSnapshot();
      applySnapshot({});
      expect(model.$lfos.value.lfo2).toEqual(LFO_DEFAULTS);
      applySnapshot(snapshot);
      expect(model.$lfos.value.lfo2).toMatchObject({
        bpm: true,
        host: false,
        trip: true,
        div: at('1/16T'),
        riseDiv: at('2 bar'),
      });
      applySnapshot({
        lfo: { l1: { bpm: 'yes', div: 99, delayDiv: 1.5, trip: false, riseDiv: at('1/8D') } },
      });
      expect(model.$lfos.value.lfo1).toEqual({ ...LFO_DEFAULTS, riseDiv: at('1/8') });
    });
  });
});
