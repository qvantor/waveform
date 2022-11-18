import { fromEvent, BehaviorSubject, filter, Subject, map, pairwise, Subscription } from 'rxjs';
import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { Note, Notes } from '@waveform/ui-kit';
import { InputControllerModule } from './input-controller';
import toast from 'react-hot-toast';

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
    return { $midiAccess, $midiInputs, $midiConnectionEvent, $midiSubscription };
  })
    .subscriptions(({ $midiAccess, $midiInputs, $midiConnectionEvent, $midiSubscription }) => [
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
      // subscribe on midi input
      $midiInputs
        .pipe(
          filter((inputs) => {
            const sub = $midiSubscription.value;
            if (sub === null) return true;
            return !inputs.includes(sub[0]);
          })
        )
        .subscribe((inputs) => {
          $midiSubscription.value?.[1].unsubscribe();
          if (inputs.length === 0) {
            $midiSubscription.next(null);
            return;
          }
          const [firstInput] = inputs;
          $midiSubscription.next([
            firstInput,
            fromEvent<WebMidi.MIDIMessageEvent>(firstInput, 'midimessage')
              .pipe(filter((e) => e.data.length === 3))
              .subscribe((e) => {
                const [control, midi] = e.data;
                if (control === 146) onPress(midiToNote(midi));
                if (control === 130) onRelease(midiToNote(midi));
              }),
          ]);
        }),
      // show message on connect/disconnect
      $midiSubscription.pipe(pairwise()).subscribe(([prev, current]) => {
        if (prev === null && current) {
          toast.success(`${current[0].manufacturer ?? 'Unknown'} ${current[0].name ?? 'Unknown'} connected`);
        }
        if (current === null && prev) {
          toast.error(`${prev[0].manufacturer ?? 'Unknown'} ${prev[0].name ?? 'Unknown'} disconnected`);
        }
      }),
    ])
    .destroy(({ $midiSubscription }) => {
      $midiSubscription.value?.[1].unsubscribe();
    });

export const { ModelProvider: MidiControllerProvider, useModel: useMidiController } = rxModelReact(
  'midiController',
  midiController
);
