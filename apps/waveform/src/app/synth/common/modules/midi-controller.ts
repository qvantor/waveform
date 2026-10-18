import { fromEvent, BehaviorSubject, distinctUntilChanged, filter, Subject, map, Subscription } from 'rxjs';
import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { Note, Notes } from '@waveform/ui-kit';
import toast from 'react-hot-toast';
import { InputControllerModule } from './input-controller';

export const midiToNote = (midiNote: number): Note => {
  const notes: Notes[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12 - 1);
  return [octave, notes[midiNote % 12]];
};

// null means all channels
const acceptsChannel = (selected: number | null, channel: number) =>
  selected === null || channel === selected;

interface Dependencies {
  inputController: InputControllerModule;
}

export const midiController = ({ inputController: [{ $pressed }, { onPress, onRelease }] }: Dependencies) =>
  rxModel(() => {
    const $midiAccess = new BehaviorSubject<WebMidi.MIDIAccess | null>(null);
    const $midiInputs = new BehaviorSubject<WebMidi.MIDIInput[]>([]);
    const $midiConnectionEvent = new Subject<WebMidi.MIDIConnectionEvent>();
    const $selectedInputId = new BehaviorSubject<string | null>(null);
    const $selectedChannel = new BehaviorSubject<number | null>(null);
    // the notes this controller pressed: midi note → the channels holding it
    const held = new Map<number, Set<number>>();

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
      held,
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
          held,
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
                  if (!acceptsChannel($selectedChannel.value, channel)) return;
                  const noteOn = control >= 144 && control <= 159;
                  // many devices send note on with velocity 0 instead of note off
                  if (noteOn && velocity > 0) {
                    const note = midiToNote(midi);
                    const channels = held.get(midi);
                    // held by QWERTY or the piano: theirs to release, not on a channel or input switch
                    if (!channels && $pressed.value[note[0]].includes(note[1])) return;
                    held.set(midi, (channels ?? new Set<number>()).add(channel));
                    onPress(note);
                  } else if (noteOn || (control >= 128 && control <= 143)) {
                    const channels = held.get(midi);
                    // not pressed on this channel: filtered out then, or another source's note
                    if (!channels?.delete(channel)) return;
                    // still held on another channel
                    if (channels.size) return;
                    held.delete(midi);
                    onRelease(midiToNote(midi));
                  }
                }),
            ]);
          }),
      ]
    )
    // the note off of a held note never comes once its channel or its input is no longer listened to
    .subscriptions(({ $selectedInputId, $selectedChannel, held }) => {
      const releaseHeld = (passes: (channel: number) => boolean) =>
        held.forEach((channels, midi) => {
          channels.forEach((channel) => {
            if (!passes(channel)) channels.delete(channel);
          });
          if (channels.size > 0) return;
          held.delete(midi);
          onRelease(midiToNote(midi));
        });
      return [
        // all channels or the same one keep every held note
        $selectedChannel.subscribe((selected) => releaseHeld((channel) => acceptsChannel(selected, channel))),
        // another input, or none: the selected one is gone
        $selectedInputId.pipe(distinctUntilChanged()).subscribe(() => releaseHeld(() => false)),
      ];
    })
    .destroy(({ $midiSubscription }) => {
      $midiSubscription.value?.[1].unsubscribe();
    });

export const { ModelProvider: MidiControllerProvider, useModel: useMidiController } = rxModelReact(
  'midiController',
  midiController
);
