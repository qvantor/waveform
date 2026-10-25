import toast from 'react-hot-toast';
import {
  createMidiAccess as createAccess,
  createMidiInput as createInput,
  midiMessage as message,
  midiStateChange as stateChange,
  provideMidiAccess,
  removeMidiAccess,
} from '../../../../test-utils/midi';
import { createSpiedInputController, initModel, stopModels } from '../../../../test-utils/models';
import { midiBend, midiController, midiToNote } from './midi-controller';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// without access the browser has no WebMIDI
const setup = async (access?: WebMidi.MIDIAccess | Promise<never>) => {
  if (access) provideMidiAccess(access);
  const { module, onPress, onRelease } = createSpiedInputController();
  const midi = initModel(midiController({ inputController: module }), 'midiController', undefined);
  await flush();
  return { midi, onPress, onRelease, input: module[0], inputActions: module[1] };
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
    expect(onPress).toHaveBeenCalledWith([4, 'C']);

    message(input, 128, 60, 0);
    expect(onRelease).toHaveBeenCalledWith([4, 'C']);

    // other channels
    message(input, 159, 69, 100);
    expect(onPress).toHaveBeenLastCalledWith([4, 'A']);
    message(input, 143, 69, 0);
    expect(onRelease).toHaveBeenLastCalledWith([4, 'A']);
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
    message(input, 248); // clock

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
    expect(onPress).toHaveBeenCalledWith([4, 'C']);
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
    expect(onPress).toHaveBeenCalledWith([4, 'D']);
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
    expect(onPress).toHaveBeenCalledWith([4, 'C']);

    midi[1].selectMidiChannel(null);
    message(input, 159, 69, 100);
    expect(onPress).toHaveBeenLastCalledWith([4, 'A']);
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
      expect(onPress).toHaveBeenCalledWith([4, 'C']);
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
});
