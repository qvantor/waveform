// WebMIDI for the specs (jsdom has none): an input and the access listing it, a message from the input

export const createMidiInput = (id: string, name = 'Keys') =>
  Object.assign(new EventTarget(), {
    id,
    name,
    manufacturer: 'Acme',
    type: 'input',
  }) as unknown as MIDIInput;

export const createMidiAccess = (inputs: MIDIInput[]) => {
  const access = Object.assign(new EventTarget(), {
    inputs: new Map(inputs.map((input) => [input.id, input])),
  });
  return access as unknown as MIDIAccess & { inputs: Map<string, MIDIInput> };
};

export const midiMessage = (input: MIDIInput, ...data: number[]) =>
  input.dispatchEvent(Object.assign(new Event('midimessage'), { data: new Uint8Array(data) }));

// a message that came at `ms` (performance.now(): the time stamp of a browser)
export const timedMidiMessage = (input: MIDIInput, ms: number, ...data: number[]) => {
  const event = Object.assign(new Event('midimessage'), { data: new Uint8Array(data) });
  Object.defineProperty(event, 'timeStamp', { value: ms });
  return input.dispatchEvent(event);
};

// the access telling that a port of the type was connected or disconnected
export const midiStateChange = (access: MIDIAccess, type: 'input' | 'output' = 'input') =>
  access.dispatchEvent(Object.assign(new Event('statechange'), { port: { type } }));

// navigator.requestMIDIAccess resolving to `access` (or rejecting); removeMidiAccess takes it away again
export const provideMidiAccess = (access: MIDIAccess | Promise<never>) =>
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: jest.fn(() => (access instanceof Promise ? access : Promise.resolve(access))),
  });
export const removeMidiAccess = () => {
  delete (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
};
