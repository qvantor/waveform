import toast from 'react-hot-toast';
import {
  createMidiAccess as createAccess,
  createMidiInput as createInput,
  midiMessage as message,
  provideMidiAccess,
  removeMidiAccess,
} from '../../../../test-utils/midi';
import { createSpiedInputController, initModel, stopModels } from '../../../../test-utils/models';
import { midiController, midiToNote } from './midi-controller';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// without access the browser has no WebMIDI
const setup = async (access?: WebMidi.MIDIAccess | Promise<never>) => {
  if (access) provideMidiAccess(access);
  const { module, onPress, onRelease } = createSpiedInputController();
  const midi = initModel(midiController({ inputController: module }), 'midiController', undefined);
  await flush();
  return { midi, onPress, onRelease };
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
    access.dispatchEvent(Object.assign(new Event('statechange'), { port: { type: 'input' } }));

    expect(midi[0].$midiInputs.value).toEqual([b]);
    expect(midi[0].$selectedInputId.value).toBe('b');

    access.inputs.delete('b');
    access.dispatchEvent(Object.assign(new Event('statechange'), { port: { type: 'input' } }));
    expect(midi[0].$selectedInputId.value).toBeNull();
  });

  it('ignores output port changes', async () => {
    const access = createAccess([createInput('a')]);
    const { midi } = await setup(access);
    const inputs = midi[0].$midiInputs.value;

    access.dispatchEvent(Object.assign(new Event('statechange'), { port: { type: 'output' } }));

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
