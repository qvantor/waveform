import { fromEvent, BehaviorSubject, filter, Subject, map, Subscription } from 'rxjs';
import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { Note, Notes } from '@waveform/ui-kit';
import toast from 'react-hot-toast';
import { InputControllerModule } from './input-controller';

const midiToNote = (midiNote: number): Note => {
  const notes: Notes[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12 - 1);
  return [octave, notes[midiNote % 12]];
};

interface Dependencies {
  inputController: InputControllerModule;
}

export const midiController = ({ inputController: [, { onPress, onRelease }] }: Dependencies) =>
  rxModel(() => {
    const $midiAccess = new BehaviorSubject<WebMidi.MIDIAccess | null>(null);
    const $midiInputs = new BehaviorSubject<WebMidi.MIDIInput[]>([]);
    const $midiConnectionEvent = new Subject<WebMidi.MIDIConnectionEvent>();
    const $selectedInputId = new BehaviorSubject<string | null>(null);

    const $midiSubscription = new BehaviorSubject<
      [target: WebMidi.MIDIInput, subscription: Subscription] | null
    >(null);

    if ('requestMIDIAccess' in navigator) {
      (async () => {
        const access = await navigator.requestMIDIAccess();
        $midiAccess.next(access);
        access.addEventListener('statechange', (e) => $midiConnectionEvent.next(e));
      })();
    }
    return { $midiAccess, $midiInputs, $midiConnectionEvent, $midiSubscription, $selectedInputId };
  })
    .actions(({ $selectedInputId }) => ({
      selectMidiInput: (id?: string) => $selectedInputId.next(id ?? null),
    }))
    .subscriptions(
      (
        { $midiAccess, $midiInputs, $midiConnectionEvent, $midiSubscription, $selectedInputId },
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
                  const [control, midi] = e.data;
                  if (control === 146) onPress(midiToNote(midi));
                  if (control === 130) onRelease(midiToNote(midi));
                }),
            ]);
          }),
      ]
    )
    .destroy(({ $midiSubscription }) => {
      $midiSubscription.value?.[1].unsubscribe();
    });

export const { ModelProvider: MidiControllerProvider, useModel: useMidiController } = rxModelReact(
  'midiController',
  midiController
);
