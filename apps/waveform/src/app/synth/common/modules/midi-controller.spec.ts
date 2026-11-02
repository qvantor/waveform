import toast from 'react-hot-toast';
import {
  createMidiAccess as createAccess,
  createMidiInput as createInput,
  midiMessage as message,
  timedMidiMessage as timed,
  midiStateChange as stateChange,
  provideMidiAccess,
  removeMidiAccess,
} from '../../../../test-utils/midi';
import {
  createSpiedInputController,
  createTransport,
  initModel,
  stopModels,
} from '../../../../test-utils/models';
import { CLOCK_LOST_MS, PPQN } from '../transport/midi-clock';
import type { TempoSegment } from '../transport/tempo-map';
import { midiBend, midiController, midiToNote } from './midi-controller';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// without access the browser has no WebMIDI
const setup = async (access?: WebMidi.MIDIAccess | Promise<never>) => {
  if (access) provideMidiAccess(access);
  const { module, onPress, onRelease } = createSpiedInputController();
  const transport = createTransport();
  const midi = initModel(midiController({ inputController: module, transport }), 'midiController', undefined);
  await flush();
  return { midi, onPress, onRelease, input: module[0], inputActions: module[1], transport };
};

afterEach(removeMidiAccess);

describe('midiToNote', () => {
  it.each([
    [60, [4, 'C']],
    [69, [4, 'A']],
    [61, [4, 'C#']],
    [0, [-1, 'C']],
    [127, [9, 'G']],
  ])('converts MIDI note %i to %o', (midi, note) => {
    expect(midiToNote(midi)).toEqual(note);
  });
});

describe('midiController', () => {
  it('works without WebMIDI support', async () => {
    const { midi } = await setup();
    expect(midi[0].$midiAccess.value).toBeNull();
    expect(midi[0].$midiInputs.value).toEqual([]);
  });

  it('stays without MIDI when access is denied', async () => {
    const { midi } = await setup(Promise.reject(new Error('denied')));
    expect(midi[0].$midiAccess.value).toBeNull();
  });

  it('selects the first input and notifies about the connection', async () => {
    const input = createInput('a');
    const { midi } = await setup(createAccess([input, createInput('b')]));
    expect(midi[0].$midiInputs.value).toHaveLength(2);
    expect(midi[0].$selectedInputId.value).toBe('a');
    expect(toast.success).toHaveBeenCalledWith('Acme Keys connected');
  });

  it('plays note on and note off messages of the selected input', async () => {
    const input = createInput('a');
    const { onPress, onRelease } = await setup(createAccess([input]));

    message(input, 144, 60, 100);
    expect(onPress).toHaveBeenCalledWith([4, 'C'], 100);

    message(input, 128, 60, 0);
    expect(onRelease).toHaveBeenCalledWith([4, 'C']);

    // other channels
    message(input, 159, 69, 100);
    expect(onPress).toHaveBeenLastCalledWith([4, 'A'], 100);
    message(input, 143, 69, 0);
    expect(onRelease).toHaveBeenLastCalledWith([4, 'A']);
  });

  it('plays a note at the velocity of its note on', async () => {
    const input = createInput('a');
    const { onPress } = await setup(createAccess([input]));

    message(input, 144, 60, 1);
    message(input, 144, 62, 127);

    expect(onPress.mock.calls).toEqual([
      [[4, 'C'], 1],
      [[4, 'D'], 127],
    ]);
  });

  it('treats note on with velocity 0 as note off', async () => {
    const input = createInput('a');
    const { onPress, onRelease } = await setup(createAccess([input]));

    message(input, 144, 60, 100);
    message(input, 144, 60, 0);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledWith([4, 'C']);
  });

  it('ignores other messages', async () => {
    const input = createInput('a');
    const { onPress, onRelease } = await setup(createAccess([input]));

    message(input, 176, 1, 64); // control change
    message(input, 248); // clock: the tempo, not a note
    message(input, 242, 0, 0); // song position: not a message of channel 2

    expect(onPress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('switches to another input on selectMidiInput', async () => {
    const a = createInput('a');
    const b = createInput('b');
    const { midi, onPress } = await setup(createAccess([a, b]));

    midi[1].selectMidiInput('b');
    message(a, 144, 60, 100);
    expect(onPress).not.toHaveBeenCalled();

    message(b, 144, 60, 100);
    expect(onPress).toHaveBeenCalledWith([4, 'C'], 100);
  });

  it('updates inputs on statechange and reselects when the selected input is gone', async () => {
    const a = createInput('a');
    const b = createInput('b');
    const access = createAccess([a, b]);
    const { midi } = await setup(access);

    access.inputs.delete('a');
    stateChange(access);

    expect(midi[0].$midiInputs.value).toEqual([b]);
    expect(midi[0].$selectedInputId.value).toBe('b');

    access.inputs.delete('b');
    stateChange(access);
    expect(midi[0].$selectedInputId.value).toBeNull();
  });

  it('ignores output port changes', async () => {
    const access = createAccess([createInput('a')]);
    const { midi } = await setup(access);
    const inputs = midi[0].$midiInputs.value;

    stateChange(access, 'output');

    expect(midi[0].$midiInputs.value).toBe(inputs);
  });

  it('stops listening to the input after stop', async () => {
    const input = createInput('a');
    const { onPress } = await setup(createAccess([input]));
    stopModels();
    message(input, 144, 60, 100);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('midiBend', () => {
  it.each([
    [0, 0, -1],
    [0, 64, 0],
    [127, 127, 1],
    [0, 32, -0.5],
    [0, 96, 4096 / 8191],
  ])('reads lsb %i, msb %i as the share %d of the range', (lsb, msb, share) => {
    expect(midiBend(lsb, msb)).toBe(share);
  });
});

describe('midiController pitch bend', () => {
  it('sets the bend of the selected channel', async () => {
    const input = createInput('a');
    const { midi, input: bus } = await setup(createAccess([input]));

    message(input, 224, 0, 0);
    expect(bus.$bend.value).toBe(-1);
    message(input, 239, 127, 127);
    expect(bus.$bend.value).toBe(1);

    midi[1].selectMidiChannel(1);
    message(input, 224, 0, 64);
    expect(bus.$bend.value).toBe(0);
    message(input, 225, 0, 32);
    message(input, 224, 0, 96);
    expect(bus.$bend.value).toBe(-0.5);
  });

  it('puts the bend back at rest on a switch to another channel or input, the input gone too', async () => {
    const a = createInput('a');
    const access = createAccess([a, createInput('b')]);
    const { midi, input: bus } = await setup(access);
    const bend = (value = 0) => message(a, 225, 0, value);

    bend(127);
    midi[1].selectMidiChannel(0);
    expect(bus.$bend.value).toBe(0);

    midi[1].selectMidiChannel(null);
    bend(127);
    midi[1].selectMidiInput('b');
    expect(bus.$bend.value).toBe(0);

    midi[1].selectMidiInput('a');
    bend(127);
    access.inputs.delete('a');
    stateChange(access);
    expect(bus.$bend.value).toBe(0);
  });

  it('keeps the bend of a channel still listened to, as its held notes', async () => {
    const input = createInput('a');
    const { midi, input: bus } = await setup(createAccess([input]));
    message(input, 225, 127, 127);

    midi[1].selectMidiChannel(1);
    midi[1].selectMidiChannel(1);
    midi[1].selectMidiChannel(null);
    expect(bus.$bend.value).toBe(1);
    midi[1].selectMidiChannel(0);
    expect(bus.$bend.value).toBe(0);
  });

  it('leaves the bend of the wheel on a switch once its own is at rest', async () => {
    const input = createInput('a');
    const { midi, input: bus, inputActions } = await setup(createAccess([input]));
    message(input, 224, 0, 127);
    message(input, 224, 0, 64);
    inputActions.setBend(0.5);

    midi[1].selectMidiChannel(0);
    expect(bus.$bend.value).toBe(0.5);
  });

  it('leaves the bend the wheel set after its own on a switch', async () => {
    const input = createInput('a');
    const { midi, input: bus, inputActions } = await setup(createAccess([input]));
    message(input, 224, 0, 127);
    inputActions.setBend(0.5);

    midi[1].selectMidiChannel(1);
    expect(bus.$bend.value).toBe(0.5);
  });

  it('takes no step of the noise of a wheel: within 2 of the last one set, rest exactly', async () => {
    const input = createInput('a');
    const { input: bus } = await setup(createAccess([input]));
    // 8192 + 1, + 2: a wheel at rest between two values
    message(input, 224, 1, 64);
    message(input, 224, 2, 64);
    expect(bus.$bend.value).toBe(0);
    message(input, 224, 3, 64);
    expect(bus.$bend.value).toBe(3 / 8191);
    message(input, 224, 1, 64);
    expect(bus.$bend.value).toBe(3 / 8191);
    message(input, 224, 0, 64);
    expect(bus.$bend.value).toBe(0);
    // another channel: its own bend
    message(input, 225, 1, 64);
    expect(bus.$bend.value).toBe(1 / 8191);
  });

  it('comes to the ends exactly, and takes a step once the wheel on the screen set another bend', async () => {
    const input = createInput('a');
    const { input: bus, inputActions } = await setup(createAccess([input]));
    message(input, 224, 125, 127);
    message(input, 224, 127, 127);
    expect(bus.$bend.value).toBe(1);
    message(input, 224, 2, 0);
    message(input, 224, 0, 0);
    expect(bus.$bend.value).toBe(-1);

    message(input, 224, 0, 96);
    inputActions.setBend(0);
    message(input, 224, 1, 96);
    expect(bus.$bend.value).toBe(4097 / 8191);
  });
});

describe('midiController channel', () => {
  it('plays only the selected channel', async () => {
    const input = createInput('a');
    const { midi, onPress, onRelease } = await setup(createAccess([input]));

    midi[1].selectMidiChannel(1);
    message(input, 144, 60, 100);
    message(input, 128, 60, 0);
    expect(onPress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();

    message(input, 145, 62, 100);
    expect(onPress).toHaveBeenCalledWith([4, 'D'], 100);
    message(input, 129, 62, 0);
    expect(onRelease).toHaveBeenCalledWith([4, 'D']);
  });

  it('takes channel 1 (0) as one channel and null as all of them', async () => {
    const input = createInput('a');
    const { midi, onPress } = await setup(createAccess([input]));

    midi[1].selectMidiChannel(0);
    message(input, 145, 62, 100);
    expect(onPress).not.toHaveBeenCalled();
    message(input, 144, 60, 100);
    expect(onPress).toHaveBeenCalledWith([4, 'C'], 100);

    midi[1].selectMidiChannel(null);
    message(input, 159, 69, 100);
    expect(onPress).toHaveBeenLastCalledWith([4, 'A'], 100);
  });

  it('releases on a channel switch only the notes of the channels it drops', async () => {
    const input = createInput('a');
    const { midi, onRelease, inputActions } = await setup(createAccess([input]));
    message(input, 144, 60, 100);
    message(input, 145, 62, 100);
    // QWERTY
    inputActions.onPress([3, 'C']);

    midi[1].selectMidiChannel(0);
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledWith([4, 'D']);

    // the late note off of the dropped channel is ignored, the kept one still ends its note
    message(input, 129, 62, 0);
    expect(onRelease).toHaveBeenCalledTimes(1);
    message(input, 128, 60, 0);
    expect(onRelease).toHaveBeenLastCalledWith([4, 'C']);
  });

  it('keeps the held notes when the same channel or all channels are selected', async () => {
    const input = createInput('a');
    const { midi, onRelease } = await setup(createAccess([input]));
    midi[1].selectMidiChannel(0);
    message(input, 144, 60, 100);

    midi[1].selectMidiChannel(0);
    midi[1].selectMidiChannel(null);
    expect(onRelease).not.toHaveBeenCalled();

    message(input, 128, 60, 0);
    expect(onRelease).toHaveBeenCalledWith([4, 'C']);
  });

  it('releases a note held on two channels with the note off of the last one', async () => {
    const input = createInput('a');
    const { onRelease } = await setup(createAccess([input]));
    message(input, 144, 60, 100);
    message(input, 145, 60, 100);

    message(input, 128, 60, 0);
    expect(onRelease).not.toHaveBeenCalled();
    message(input, 129, 60, 0);
    expect(onRelease).toHaveBeenCalledWith([4, 'C']);
  });

  it('keeps a note held on two channels when one of them is dropped', async () => {
    const input = createInput('a');
    const { midi, onRelease } = await setup(createAccess([input]));
    message(input, 144, 60, 100);
    message(input, 145, 60, 100);

    midi[1].selectMidiChannel(1);
    expect(onRelease).not.toHaveBeenCalled();
    message(input, 129, 60, 0);
    expect(onRelease).toHaveBeenCalledWith([4, 'C']);
  });

  it('releases the notes held on the previous input', async () => {
    const a = createInput('a');
    const { midi, onRelease, inputActions } = await setup(createAccess([a, createInput('b')]));
    message(a, 144, 60, 100);
    inputActions.onPress([3, 'C']);

    midi[1].selectMidiInput('a');
    expect(onRelease).not.toHaveBeenCalled();

    midi[1].selectMidiInput('b');
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledWith([4, 'C']);
  });

  it('releases the notes of the selected input once it is gone', async () => {
    const input = createInput('a');
    const access = createAccess([input]);
    const { midi, onRelease } = await setup(access);
    message(input, 144, 60, 100);

    access.inputs.delete('a');
    stateChange(access);
    expect(midi[0].$selectedInputId.value).toBeNull();
    expect(onRelease).toHaveBeenCalledWith([4, 'C']);
  });

  it('ignores the note off of a note it did not press', async () => {
    const input = createInput('a');
    const { midi, onRelease, inputActions } = await setup(createAccess([input]));
    midi[1].selectMidiChannel(0);
    // filtered out, its note off comes once all channels are listened to
    message(input, 145, 60, 100);
    midi[1].selectMidiChannel(null);
    // QWERTY
    inputActions.onPress([4, 'C']);

    message(input, 129, 60, 0);
    message(input, 128, 62, 0);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('leaves a note held by QWERTY to it', async () => {
    const input = createInput('a');
    const { midi, onPress, onRelease, inputActions } = await setup(createAccess([input]));
    inputActions.onPress([4, 'C']);
    message(input, 145, 60, 100);
    message(input, 144, 60, 100);
    expect(onPress).toHaveBeenCalledTimes(1);

    // neither a channel switch nor a note off ends it
    midi[1].selectMidiChannel(0);
    message(input, 128, 60, 0);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('leaves a note held by QWERTY to it on an input switch', async () => {
    const a = createInput('a');
    const { midi, onRelease, inputActions } = await setup(createAccess([a, createInput('b')]));
    inputActions.onPress([4, 'C']);
    message(a, 144, 60, 100);

    midi[1].selectMidiInput('b');
    expect(onRelease).not.toHaveBeenCalled();
  });

  describe('the choice of the tab', () => {
    const storeChoice = (choice: unknown) => sessionStorage.setItem('midiInput', JSON.stringify(choice));
    const storedChoice = () => JSON.parse(sessionStorage.getItem('midiInput') ?? 'null');

    it('a reload keeps the input and the channel chosen in the tab', async () => {
      storeChoice({ inputId: 'b', channel: 3 });
      const b = createInput('b');
      const { midi, onPress } = await setup(createAccess([createInput('a'), b]));
      expect(midi[0].$selectedInputId.value).toBe('b');
      expect(midi[0].$selectedChannel.value).toBe(3);

      message(b, 144, 60, 100);
      expect(onPress).not.toHaveBeenCalled();
      message(b, 147, 60, 100);
      expect(onPress).toHaveBeenCalledWith([4, 'C'], 100);
    });

    it('keeps what the user chooses, not the input selected for them', async () => {
      const { midi } = await setup(createAccess([createInput('a'), createInput('b')]));
      expect(midi[0].$selectedInputId.value).toBe('a');
      expect(storedChoice()).toEqual({ inputId: null, channel: null });

      midi[1].selectMidiInput('b');
      midi[1].selectMidiChannel(2);
      expect(storedChoice()).toEqual({ inputId: 'b', channel: 2 });
    });

    it('plays the first input while the chosen one is unplugged and comes back to it', async () => {
      storeChoice({ inputId: 'b', channel: null });
      const b = createInput('b');
      const access = createAccess([createInput('a')]);
      const { midi } = await setup(access);
      expect(midi[0].$selectedInputId.value).toBe('a');

      access.inputs.set('b', b);
      stateChange(access);
      expect(midi[0].$selectedInputId.value).toBe('b');

      access.inputs.delete('b');
      stateChange(access);
      expect(midi[0].$selectedInputId.value).toBe('a');
      expect(storedChoice()).toEqual({ inputId: 'b', channel: null });
    });

    it.each([
      ['a channel out of 0..15', JSON.stringify({ inputId: 'b', channel: 16 })],
      ['a wrong input', JSON.stringify({ inputId: 2, channel: null })],
      ['broken json', 'broken'],
    ])('ignores %s', async (_, raw) => {
      sessionStorage.setItem('midiInput', raw);
      const { midi } = await setup(createAccess([createInput('a'), createInput('b')]));
      expect(midi[0].$selectedInputId.value).toBe('a');
      expect(midi[0].$selectedChannel.value).toBeNull();
    });
  });

  describe('MIDI Clock', () => {
    // the clock of performance.now() at `now` ms; Chrome stamps a MIDI message 0: its time is the moment the page
    // takes it
    const NOW = 10000;
    let now = NOW;
    beforeEach(() => {
      now = NOW;
      jest.spyOn(performance, 'now').mockImplementation(() => now);
      // the output plays the time 0 of the context at NOW (the mock has no getOutputTimestamp)
      Object.defineProperty(AudioContext.prototype, 'getOutputTimestamp', {
        configurable: true,
        value: () => ({ contextTime: 0, performanceTime: NOW }),
      });
    });
    afterEach(() => {
      jest.useRealTimers();
      Reflect.deleteProperty(AudioContext.prototype, 'getOutputTimestamp');
    });
    // `count` clocks at `bpm` from `from` ms, each taken `delay()` ms late, stamped 0 (Chrome) or at its time
    const clocks = (
      input: WebMidi.MIDIInput,
      bpm: number,
      from: number,
      count: number,
      { delay = (): number => 0, stamped = false } = {}
    ) => {
      const step = 60000 / bpm / PPQN;
      for (let i = 0; i < count; i++) {
        now = from + i * step + delay();
        timed(input, stamped ? from + i * step : 0, 248);
      }
      return from + count * step;
    };
    // a delay of up to 70 ms now and then (a busy main thread), up to 2 ms else
    const jitter = () => {
      let seed = 7;
      const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
      return () => (random() < 0.3 ? random() * 70 : random() * 2);
    };

    it('a clock of the input leads the tempo of the transport', async () => {
      const input = createInput('a');
      const { transport } = await setup(createAccess([input]));
      clocks(input, 128, NOW, 3 * PPQN);
      expect(transport[0].$source.value).toBe('midi');
      expect(transport[0].$tempo.value).toBeCloseTo(128, 6);
      // not kept: the field keeps its own
      expect(transport[0].$bpm.value).toBe(120);
    });

    it('takes its tempo through the delays of the main thread: within 0.1 BPM', async () => {
      const input = createInput('a');
      const { transport } = await setup(createAccess([input]));
      clocks(input, 110, NOW, 16 * PPQN, { delay: jitter() });
      expect(Math.abs(transport[0].$tempo.value - 110)).toBeLessThan(0.1);
    });

    it('takes the time stamp of a message where it is one: a clock taken late counts at its own time', async () => {
      const input = createInput('a');
      const { transport } = await setup(createAccess([input]));
      clocks(input, 110, NOW, 4 * PPQN, { delay: jitter(), stamped: true });
      expect(transport[0].$tempo.value).toBeCloseTo(110, 6);
    });

    it('Start takes the transport to beat 0 at the next clock, Stop and Continue play it', async () => {
      const input = createInput('a');
      const { transport } = await setup(createAccess([input]));
      const at = clocks(input, 120, NOW, 2 * PPQN);
      message(input, 250);
      expect(transport[0].$playing.value).toBe(true);
      clocks(input, 120, at, 1);
      // the transport at beat 0 at the time the output plays the moment the clock came
      expect(transport[0].beatAt(transport[0].contextTimeAt(now))).toBeCloseTo(0, 3);
      message(input, 252);
      expect(transport[0].$playing.value).toBe(false);
      message(input, 251);
      expect(transport[0].$playing.value).toBe(true);
    });

    it('a Song Position takes the transport there, whatever channel is selected', async () => {
      const input = createInput('a');
      const { midi, transport, onPress } = await setup(createAccess([input]));
      midi[1].selectMidiChannel(5);
      const changes: boolean[] = [];
      transport[0].$changes.subscribe(({ locate }) => changes.push(locate));
      // 32 sixteenths: beat 8
      timed(input, 0, 242, 32, 0);
      expect(changes).toEqual([true]);
      // at the moment it came: the segment from now + LFO_LEAD on is on that line (2 beats a second)
      const segment = transport[0].$segments.value.at(-1) as TempoSegment;
      expect(segment.beat - (segment.time - transport[0].contextTimeAt(now)) * 2).toBeCloseTo(8, 9);
      expect(onPress).not.toHaveBeenCalled();
    });

    it(`is lost after ${CLOCK_LOST_MS} ms without a clock: the tempo of the field leads again`, async () => {
      const input = createInput('a');
      const { transport } = await setup(createAccess([input]));
      jest.useFakeTimers({ doNotFake: ['performance'] });
      clocks(input, 90, NOW, 2 * PPQN);
      expect(transport[0].$tempo.value).toBeCloseTo(90, 6);
      jest.advanceTimersByTime(CLOCK_LOST_MS - 10);
      expect(transport[0].$source.value).toBe('midi');
      jest.advanceTimersByTime(20);
      expect(transport[0].$source.value).toBe('internal');
      expect(transport[0].$tempo.value).toBe(120);
      expect(transport[0].$playing.value).toBe(false);
    });

    it('lost, a Continue goes on where the clock stopped: a DAW stopped sends no clocks', async () => {
      const input = createInput('a');
      const { transport } = await setup(createAccess([input]));
      jest.useFakeTimers({ doNotFake: ['performance'] });
      let at = clocks(input, 120, NOW, PPQN);
      message(input, 250);
      at = clocks(input, 120, at, 2 * PPQN + 1);
      message(input, 252);
      jest.advanceTimersByTime(CLOCK_LOST_MS + 10);
      expect(transport[0].$source.value).toBe('internal');
      message(input, 251);
      clocks(input, 120, at + 1000, 1);
      // the 2 beats and one clock after Start
      expect(transport[0].beatAt(transport[0].contextTimeAt(now))).toBeCloseTo(2 + 1 / PPQN, 3);
    });

    it('another input forgets where the clock of the one before stopped: its Continue goes on from beat 0', async () => {
      const a = createInput('a');
      const b = createInput('b');
      const { midi, transport } = await setup(createAccess([a, b]));
      let at = clocks(a, 120, NOW, PPQN);
      message(a, 250);
      at = clocks(a, 120, at, 2 * PPQN + 1);
      message(a, 252);
      midi[1].selectMidiInput('b');
      message(b, 251);
      clocks(b, 120, at + 1000, 1);
      expect(transport[0].beatAt(transport[0].contextTimeAt(now))).toBeCloseTo(0, 3);
    });

    it('is lost on another input; the clock of an input not selected leads nothing', async () => {
      const a = createInput('a');
      const b = createInput('b');
      const { midi, transport } = await setup(createAccess([a, b]));
      clocks(b, 90, NOW, 2 * PPQN);
      expect(transport[0].$source.value).toBe('internal');
      clocks(a, 90, NOW, 2 * PPQN);
      expect(transport[0].$source.value).toBe('midi');
      midi[1].selectMidiInput('b');
      expect(transport[0].$source.value).toBe('internal');
    });

    it('forgets a Start without clocks on another input: the first clock of that one moves nothing', async () => {
      const a = createInput('a');
      const b = createInput('b');
      const { midi, transport } = await setup(createAccess([a, b]));
      const locates: boolean[] = [];
      transport[0].$changes.subscribe(({ locate }) => locates.push(locate));
      message(a, 250);
      expect(transport[0].$playing.value).toBe(true);
      midi[1].selectMidiInput('b');
      expect(transport[0].$playing.value).toBe(false);
      clocks(b, 90, NOW, 2 * PPQN);
      expect(transport[0].$source.value).toBe('midi');
      expect(transport[0].$playing.value).toBe(false);
      expect(locates).not.toContain(true);
    });

    describe('switched off', () => {
      it('follows the clock by default', async () => {
        const { midi } = await setup(createAccess([createInput('a')]));
        expect(midi[0].$clockSync.value).toBe(true);
      });

      it('the clock, Start, Stop and a Song Position of the input lead nothing; its notes play', async () => {
        const input = createInput('a');
        const { midi, transport, onPress } = await setup(createAccess([input]));
        midi[1].setClockSync(false);
        const changes: boolean[] = [];
        transport[0].$changes.subscribe(({ locate }) => changes.push(locate));

        const at = clocks(input, 128, NOW, 3 * PPQN);
        message(input, 250);
        clocks(input, 128, at, PPQN);
        timed(input, 0, 242, 32, 0);
        message(input, 251);
        expect(transport[0].$source.value).toBe('internal');
        expect(transport[0].$tempo.value).toBe(120);
        expect(transport[0].$playing.value).toBe(false);
        expect(changes).toEqual([]);

        message(input, 144, 60, 100);
        expect(onPress).toHaveBeenCalledWith([4, 'C'], 100);
      });

      it('while it leads: the tempo of the field leads again, the transport stops; on again, the next clocks lead', async () => {
        const input = createInput('a');
        const { midi, transport } = await setup(createAccess([input]));
        jest.useFakeTimers({ doNotFake: ['performance'] });
        let at = clocks(input, 90, NOW, PPQN);
        message(input, 250);
        at = clocks(input, 90, at, 2 * PPQN);
        expect(transport[0].$source.value).toBe('midi');
        expect(transport[0].$playing.value).toBe(true);

        midi[1].setClockSync(false);
        expect(transport[0].$source.value).toBe('internal');
        expect(transport[0].$tempo.value).toBe(120);
        expect(transport[0].$playing.value).toBe(false);
        // the timer of a lost clock is gone with it
        jest.advanceTimersByTime(CLOCK_LOST_MS + 10);
        expect(transport[0].$source.value).toBe('internal');

        midi[1].setClockSync(true);
        expect(transport[0].$source.value).toBe('internal');
        clocks(input, 100, at + 1000, 2 * PPQN);
        expect(transport[0].$source.value).toBe('midi');
        expect(transport[0].$tempo.value).toBeCloseTo(100, 6);
      });

      it('forgets where the clock stopped: a Continue after it goes on from beat 0', async () => {
        const input = createInput('a');
        const { midi, transport } = await setup(createAccess([input]));
        let at = clocks(input, 120, NOW, PPQN);
        message(input, 250);
        at = clocks(input, 120, at, 2 * PPQN + 1);
        message(input, 252);
        midi[1].setClockSync(false);
        midi[1].setClockSync(true);
        message(input, 251);
        clocks(input, 120, at + 1000, 1);
        expect(transport[0].beatAt(transport[0].contextTimeAt(now))).toBeCloseTo(0, 3);
      });

      it('the browser keeps the switch', async () => {
        const { midi } = await setup(createAccess([createInput('a')]));
        expect(localStorage.getItem('midiClock')).toBeNull();
        midi[1].setClockSync(false);
        expect(localStorage.getItem('midiClock')).toBe('false');
        stopModels();

        const input = createInput('a');
        const { midi: reloaded, transport } = await setup(createAccess([input]));
        expect(reloaded[0].$clockSync.value).toBe(false);
        clocks(input, 128, NOW, 2 * PPQN);
        expect(transport[0].$source.value).toBe('internal');
        reloaded[1].setClockSync(true);
        expect(localStorage.getItem('midiClock')).toBe('true');
      });

      it.each([
        ['a value that is no boolean', '"off"'],
        ['broken json', 'broken'],
      ])('follows the clock where the browser keeps %s', async (_, raw) => {
        localStorage.setItem('midiClock', raw);
        const { midi } = await setup(createAccess([createInput('a')]));
        expect(midi[0].$clockSync.value).toBe(true);
      });
    });
  });
});
