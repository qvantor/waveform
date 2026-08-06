import { fromEvent, BehaviorSubject, filter, Subject, map, skip, Subscription } from 'rxjs';
import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { Note, Notes } from '@waveform/ui-kit';
import toast from 'react-hot-toast';
import { InputControllerModule } from './input-controller';

export const midiToNote = (midiNote: number): Note => {
  const notes: Notes[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12 - 1);
  return [octave, notes[midiNote % 12]];
};

interface Dependencies {
  inputController: InputControllerModule;
}

export const midiController = ({ inputController: [{ $pressed }, { onPress, onRelease }] }: Dependencies) =>
  rxModel(() => {
    const $midiAccess = new BehaviorSubject<WebMidi.MIDIAccess | null>(null);
    const $midiInputs = new BehaviorSubject<WebMidi.MIDIInput[]>([]);
    const $midiConnectionEvent = new Subject<WebMidi.MIDIConnectionEvent>();
    const $selectedInputId = new BehaviorSubject<string | null>(null);
    // null means all channels
    const $selectedChannel = new BehaviorSubject<number | null>(null);

    const $midiSubscription = new BehaviorSubject<
      [target: WebMidi.MIDIInput, subscription: Subscription] | null
    >(null);

    if ('requestMIDIAccess' in navigator) {
      navigator
        .requestMIDIAccess()
        .then((access) => {
          $midiAccess.next(access);
          access.addEventListener('statechange', (e) => $midiConnectionEvent.next(e));
        })
        // permission denied or no MIDI support (common on mobile): stay without MIDI input
        .catch(() => undefined);
    }
    return {
      $midiAccess,
      $midiInputs,
      $midiConnectionEvent,
      $midiSubscription,
      $selectedInputId,
      $selectedChannel,
    };
  })
    .actions(({ $selectedInputId, $selectedChannel }) => ({
      selectMidiInput: (id?: string) => $selectedInputId.next(id ?? null),
      selectMidiChannel: (channel: number | null) => $selectedChannel.next(channel),
    }))
    .subscriptions(
      (
        {
          $midiAccess,
          $midiInputs,
          $midiConnectionEvent,
          $midiSubscription,
          $selectedInputId,
          $selectedChannel,
        },
        { selectMidiInput }
      ) => [
        // initial midi inputs
        $midiAccess
          .pipe(
            filter(Boolean),
            map((midiAccess) => [...midiAccess.inputs.values()])
          )
          .subscribe($midiInputs),
        // update midi inputs on change
        $midiConnectionEvent
          .pipe(
            filter((event) => event.port.type !== 'output'),
            map(() => $midiAccess.value),
            filter(Boolean),
            map((midiAccess) => [...midiAccess.inputs.values()])
          )
          .subscribe($midiInputs),
        // Select midi input if not selected
        $midiInputs
          .pipe(
            filter((inputs) => {
              if ($selectedInputId.value === null) return true;
              return !inputs.some((input) => input.id === $selectedInputId.value);
            })
          )
          .subscribe((inputs) => {
            if (inputs.length === 0) return selectMidiInput();
            selectMidiInput(inputs[0].id);
          }),

        $selectedInputId
          .pipe(
            filter(Boolean),
            map((id) => $midiInputs.value.find((input) => input.id === id)),
            filter(Boolean)
          )
          .subscribe((input) => {
            $midiSubscription.value?.[1].unsubscribe();
            toast.success(`${input.manufacturer ?? 'Unknown'} ${input.name ?? 'Unknown'} connected`);
            $midiSubscription.next([
              input,
              fromEvent<WebMidi.MIDIMessageEvent>(input, 'midimessage')
                .pipe(filter((e) => e.data.length === 3))
                .subscribe((e) => {
                  const [control, midi, velocity] = e.data;
                  const channel = control & 0b1111;
                  if ($selectedChannel.value !== null && channel !== $selectedChannel.value) return;
                  const noteOn = control >= 144 && control <= 159;
                  // many devices send note on with velocity 0 instead of note off
                  if (noteOn && velocity > 0) onPress(midiToNote(midi));
                  else if (noteOn || (control >= 128 && control <= 143)) onRelease(midiToNote(midi));
                }),
            ]);
          }),

        // notes held on the previous channel would never get their note off
        $selectedChannel
          .pipe(skip(1))
          .subscribe(() =>
            Object.entries($pressed.value).forEach(([octave, notes]) =>
              notes.forEach((note) => onRelease([Number(octave), note]))
            )
          ),
      ]
    )
    .destroy(({ $midiSubscription }) => {
      $midiSubscription.value?.[1].unsubscribe();
    });

export const { ModelProvider: MidiControllerProvider, useModel: useMidiController } = rxModelReact(
  'midiController',
  midiController
);
