import { registrar } from 'standardized-audio-context-mock';
import { appModel } from '../../../app/modules/app-module';
import {
  createMidiAccess,
  createMidiInput,
  midiMessage,
  provideMidiAccess,
  removeMidiAccess,
} from '../../../../test-utils/midi';
import { createSynth, initModel } from '../../../../test-utils/models';
import { WorkerStub } from '../../../../test-utils/worker-stub';
import { eventsOf, voiceEvents, voicesNodes } from '../../../../test-utils/voice-events';
import { keyboardController } from './keyboard-controller';
import { midiController } from './midi-controller';

// the path of a note from its input to its voice: the keyboard, a MIDI input and a note right after a new
// table make the voice in the task of the event, scheduled at the context time then, and send it to the voices
// node before the task ends (its microtask; no timer on the way: what the page adds to the latency is the time of
// that task, measured by the browser suite, scripts/bench-perf L1 and L3)

// the wavetable oscillator and the MIDI access load asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));

const setup = async () => {
  const input = createMidiInput('a');
  provideMidiAccess(createMidiAccess([input]));
  const modules = createSynth();
  const app = initModel(appModel(), 'appModel', undefined);
  initModel(
    keyboardController({ app, inputController: modules.inputController }),
    'keyboardController',
    undefined
  );
  initModel(midiController({ inputController: modules.inputController }), 'midiController', undefined);
  await flush();
  const [{ audioCtx, wavetables }] = modules.synthCore;
  const { voices } = voiceEvents(audioCtx, wavetables);
  const key = (type: 'keydown' | 'keyup', code: string) =>
    document.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
  const travel = (seconds: number) => registrar.getDeLorean(audioCtx as never)?.travel(seconds);
  return { ...modules, audioCtx, wavetables, voices, key, input, travel };
};

afterEach(removeMidiAccess);

describe('the path of a note', () => {
  it('a key makes the voice in its keydown event, at the context time, sent before its task ends', async () => {
    const { key, voices, audioCtx, travel } = await setup();
    travel(1.5);
    key('keydown', 'KeyQ');
    await Promise.resolve();
    expect(eventsOf(voicesNodes(audioCtx)[0])).toHaveLength(1);
    expect(voices()).toHaveLength(1);
    expect(voices()[0].options.start).toBe(audioCtx.currentTime);
    expect(audioCtx.currentTime).toBe(1.5);
  });

  it('a MIDI note on makes the voice in its midimessage event', async () => {
    const { input, voices } = await setup();
    midiMessage(input, 144, 60, 100);
    expect(voices()).toHaveLength(1);
  });

  it('a note right after a new table plays at once, the table is built meanwhile', async () => {
    const { key, voices, osc1, wavetables, audioCtx } = await setup();
    const [worker] = WorkerStub.created;
    worker.postMessage.mockClear();
    osc1[1].setWaveTable([
      [0, 1, 0, -1],
      [1, 0, -1, 0],
    ]);
    key('keydown', 'KeyQ');
    // the voice plays the previous version (or a sine) and crossfades into the new one once it is stored
    expect(voices()).toHaveLength(1);
    expect(wavetables.pending()).toContain(osc1[0].id);
    const sent = worker.postMessage.mock.invocationCallOrder[0];
    const played = voicesNodes(audioCtx)[0].port.postMessage.mock.invocationCallOrder.at(-1) as number;
    expect(sent).toBeLessThan(played);
  });

  it('trills: a voice for every key press, 20 presses a second for 10 s', async () => {
    const { key, voices, travel } = await setup();
    for (let i = 0; i < 200; i++) {
      const code = i % 2 ? 'KeyW' : 'KeyQ';
      key('keydown', code);
      travel(0.04);
      key('keyup', code);
      travel(0.01);
    }
    expect(voices()).toHaveLength(200);
  });
});
