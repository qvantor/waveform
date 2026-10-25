import {
  fromEvent,
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  filter,
  Subject,
  map,
  Subscription,
} from 'rxjs';
import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { Note, Notes } from '@waveform/ui-kit';
import toast from 'react-hot-toast';
import { readStored, writeStored } from '../../../common/services';
import { InputControllerModule } from './input-controller';

export const midiToNote = (midiNote: number): Note => {
  const notes: Notes[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12 - 1);
  return [octave, notes[midiNote % 12]];
};

// a pitch bend message: 14 bits (its second byte the low 7, its third the high 7), 8192 at rest, as a share of
// the range: -1 at 0, 1 at 16383 (the range up has one step less)
export const midiBend = (lsb: number, msb: number) => {
  const bend = ((msb << 7) | lsb) - 8192;
  return bend / (bend > 0 ? 8191 : 8192);
};

// null means all channels
const acceptsChannel = (selected: number | null, channel: number) =>
  selected === null || channel === selected;

// the input and the channel chosen in the tab (sessionStorage): they survive a reload
const TAB_CHOICE_KEY = 'midiInput';

interface TabChoice {
  inputId: string | null;
  channel: number | null;
}

const isTabChoice = (value: unknown): value is TabChoice => {
  const { inputId, channel } = (value ?? {}) as Partial<Record<keyof TabChoice, unknown>>;
  return (
    (inputId === null || typeof inputId === 'string') &&
    (channel === null ||
      (typeof channel === 'number' && Number.isInteger(channel) && channel >= 0 && channel < 16))
  );
};

interface Dependencies {
  inputController: InputControllerModule;
}

export const midiController = ({
  inputController: [{ $pressed }, { onPress, onRelease, setBend }],
}: Dependencies) =>
  rxModel(() => {
    const $midiAccess = new BehaviorSubject<WebMidi.MIDIAccess | null>(null);
    const $midiInputs = new BehaviorSubject<WebMidi.MIDIInput[]>([]);
    const $midiConnectionEvent = new Subject<WebMidi.MIDIConnectionEvent>();
    const saved = readStored<TabChoice>(
      'sessionStorage',
      TAB_CHOICE_KEY,
      { inputId: null, channel: null },
      isTabChoice
    );
    // the input the user chose, selected whenever it is connected; the input selected is another one meanwhile
    const $chosenInputId = new BehaviorSubject<string | null>(saved.inputId);
    const $selectedInputId = new BehaviorSubject<string | null>(null);
    const $selectedChannel = new BehaviorSubject<number | null>(saved.channel);
    // the notes this controller pressed: midi note → the channels holding it
    const held = new Map<number, Set<number>>();
    // the last pitch bend this controller set and its channel (the wheel on the screen sets it too)
    const bend = { value: 0, channel: 0 };

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
      $chosenInputId,
      $selectedInputId,
      $selectedChannel,
      held,
      bend,
    };
  })
    .actions(({ $chosenInputId, $selectedInputId, $selectedChannel }) => ({
      selectMidiInput: (id: string) => {
        $chosenInputId.next(id);
        $selectedInputId.next(id);
      },
      selectMidiChannel: (channel: number | null) => $selectedChannel.next(channel),
    }))
    .subscriptions(
      ({
        $midiAccess,
        $midiInputs,
        $midiConnectionEvent,
        $midiSubscription,
        $chosenInputId,
        $selectedInputId,
        $selectedChannel,
        held,
        bend,
      }) => [
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
        // the chosen input once it is connected, else the selected one while it is, else the first one
        $midiInputs
          .pipe(
            map((inputs) => {
              const connected = (id: string | null) => inputs.some((input) => input.id === id);
              if (connected($chosenInputId.value)) return $chosenInputId.value;
              if (connected($selectedInputId.value)) return $selectedInputId.value;
              return inputs[0]?.id ?? null;
            }),
            filter((id) => id !== $selectedInputId.value)
          )
          .subscribe((id) => $selectedInputId.next(id)),
        combineLatest([$chosenInputId, $selectedChannel]).subscribe(([inputId, channel]) =>
          writeStored('sessionStorage', TAB_CHOICE_KEY, { inputId, channel })
        ),

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
                  // pitch bend: the bytes of a note are its low and high 7 bits
                  if (control >= 224 && control <= 239) {
                    bend.value = midiBend(midi, velocity);
                    bend.channel = channel;
                    setBend(bend.value);
                    return;
                  }
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
    // the note off of a held note never comes once its channel or its input is no longer listened to, nor the
    // pitch bend back at rest: it goes back to 0 (a wheel left bent would hold the pitch); those of a channel
    // still listened to stay
    .subscriptions(({ $selectedInputId, $selectedChannel, held, bend }) => {
      const releaseHeld = (passes: (channel: number) => boolean) => {
        if (bend.value !== 0 && !passes(bend.channel)) {
          bend.value = 0;
          setBend(0);
        }
        held.forEach((channels, midi) => {
          channels.forEach((channel) => {
            if (!passes(channel)) channels.delete(channel);
          });
          if (channels.size > 0) return;
          held.delete(midi);
          onRelease(midiToNote(midi));
        });
      };
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
