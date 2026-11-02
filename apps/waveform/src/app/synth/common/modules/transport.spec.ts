import { registrar } from 'standardized-audio-context-mock';
import { createSynthCore, createTransport } from '../../../../test-utils/models';
import { blockStorage, fillStorage } from '../../../../test-utils/storage';
import { applySnapshot, getSnapshot } from '../../../app';
import { LFO_LEAD, LFO_STATE_INTERVAL } from '../lfo/lfo-curve';
import { TempoChange } from './transport';

// a second change within LFO_STATE_INTERVAL goes out after it
const interval = () => new Promise((resolve) => setTimeout(resolve, LFO_STATE_INTERVAL * 1000 + 5));

const setup = () => {
  const synthCore = createSynthCore();
  const [{ audioCtx }] = synthCore;
  const [model, actions] = createTransport(synthCore);
  const changes: TempoChange[] = [];
  model.$changes.subscribe((change) => changes.push(change));
  const travel = (seconds: number) => registrar.getDeLorean(audioCtx as never)?.travel(seconds);
  return { model, actions, audioCtx, changes, travel };
};

describe('transport', () => {
  it('is at 120 BPM, beat 0 at the time 0 of the context, internal and stopped', () => {
    const { model } = setup();
    expect(model.$bpm.value).toBe(120);
    expect(model.$tempo.value).toBe(120);
    expect(model.$source.value).toBe('internal');
    expect(model.$playing.value).toBe(false);
    expect(model.$segments.value).toEqual([{ time: 0, beat: 0, bpm: 120 }]);
    expect(model.beatAt(1)).toBe(2);
    expect(model.timeAt(4)).toBe(2);
    expect(model.secondsOf(8)).toBe(0.5);
  });

  it('keeps the tempo of the field in the browser, not in the snapshot', () => {
    const { actions } = setup();
    actions.setBpm(93.456);
    expect(localStorage.getItem('tempo')).toBe('93.46');
    expect(getSnapshot()).not.toHaveProperty('transport');
    applySnapshot({});
    const [again] = createTransport();
    expect(again.$bpm.value).toBe(93.46);
    expect(again.$segments.value).toEqual([{ time: 0, beat: 0, bpm: 93.46 }]);
  });

  it('takes a stored tempo within its range only', () => {
    ['500', '"fast"', 'broken'].forEach((stored) => {
      localStorage.setItem('tempo', stored);
      expect(createTransport()[0].$bpm.value).toBe(120);
    });
  });

  it('keeps the tempo within 20..300 on the grid of 0.01', () => {
    const { model, actions } = setup();
    actions.setBpm(10);
    expect(model.$bpm.value).toBe(20);
    actions.setBpm(1000);
    expect(model.$bpm.value).toBe(300);
  });

  it('plays without a storage: the default, a new tempo until the page reloads', () => {
    blockStorage('localStorage');
    const { model, actions } = setup();
    expect(model.$bpm.value).toBe(120);
    actions.setBpm(140);
    expect(model.$tempo.value).toBe(140);
  });

  it('plays with a full storage', () => {
    fillStorage();
    const { model, actions } = setup();
    actions.setBpm(140);
    expect(model.$tempo.value).toBe(140);
    expect(localStorage.getItem('tempo')).toBeNull();
  });

  it('starts a new tempo LFO_LEAD after now at the beat there: the beat goes on', () => {
    const { model, actions, changes, audioCtx, travel } = setup();
    travel(1.3);
    actions.setBpm(60);
    const time = audioCtx.currentTime + LFO_LEAD;
    expect(changes).toEqual([{ segment: { time, beat: time * 2, bpm: 60 }, locate: false }]);
    expect(model.$tempo.value).toBe(60);
    expect(model.beatAt(time)).toBeCloseTo(time * 2, 12);
    expect(model.beatAt(time + 1)).toBeCloseTo(time * 2 + 1, 12);
  });

  it('starts a new tempo at most every LFO_STATE_INTERVAL: the first at once, the last after it', async () => {
    const { model, actions, changes } = setup();
    actions.setBpm(130);
    actions.setBpm(140);
    actions.setBpm(150);
    expect(changes.map(({ segment }) => segment.bpm)).toEqual([130]);
    await interval();
    expect(changes.map(({ segment }) => segment.bpm)).toEqual([130, 150]);
    expect(model.$bpm.value).toBe(150);
  });

  it('locates the transport at a beat: not before now + LFO_LEAD, on its line from there', () => {
    const { model, actions, changes, audioCtx, travel } = setup();
    travel(2);
    actions.locate(0, audioCtx.currentTime + 0.1);
    expect(changes.at(-1)).toEqual({ segment: { time: 2.1, beat: 0, bpm: 120 }, locate: true });
    expect(model.beatAt(2.6)).toBeCloseTo(1, 12);
    actions.locate(16, 1);
    const time = audioCtx.currentTime + LFO_LEAD;
    expect(changes.at(-1)?.segment.time).toBe(time);
    expect(changes.at(-1)?.segment.beat).toBeCloseTo(16 + (time - 1) * 2, 12);
  });

  it('follows a tempo of a MIDI Clock without keeping it, its own tempo again once internal', async () => {
    const { model, actions, changes, audioCtx, travel } = setup();
    travel(1);
    actions.setSource('midi');
    actions.follow({ time: audioCtx.currentTime + 0.05, beat: 8, bpm: 128 });
    expect(changes.at(-1)).toEqual({ segment: { time: 1.05, beat: 8, bpm: 128 }, locate: false });
    expect(model.$tempo.value).toBe(128);
    expect(model.$bpm.value).toBe(120);
    expect(localStorage.getItem('tempo')).toBeNull();
    // a segment from before now: on its line from now + LFO_LEAD on
    actions.follow({ time: 0.5, beat: 2, bpm: 128 });
    const time = audioCtx.currentTime + LFO_LEAD;
    expect(changes.at(-1)?.segment.beat).toBeCloseTo(2 + ((time - 0.5) * 128) / 60, 12);
    // the field while a MIDI Clock leads: the tempo stays the clock's
    actions.setBpm(100);
    expect(model.$tempo.value).toBe(128);
    actions.setSource('internal');
    expect(model.$tempo.value).toBe(100);
    expect(changes.at(-1)?.segment.bpm).toBe(100);
    await interval();
  });

  it('plays from a MIDI Start to its Stop', () => {
    const { model, actions } = setup();
    actions.setPlaying(true);
    expect(model.$playing.value).toBe(true);
    actions.setPlaying(false);
    expect(model.$playing.value).toBe(false);
  });
});
