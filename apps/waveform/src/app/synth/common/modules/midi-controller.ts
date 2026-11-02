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
import { messageTime, readStored, writeStored } from '../../../common/services';
import { CLOCK_LOST_MS, createMidiClock } from '../transport/midi-clock';
import { InputControllerModule } from './input-controller';
import type { TransportModule } from './transport';

export const midiToNote = (midiNote: number): Note => {
  const notes: Notes[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12 - 1);
  return [octave, notes[midiNote % 12]];
};

// the 14 bits of a pitch bend message at rest and all the way up
const BEND_REST = 8192;
const BEND_MAX = 16383;
// the steps of the noise of a wheel (at rest between two values, or under a finger): a bend within as many of the
// last one set moves nothing while that one plays, every new bend takes the voices off their mix tables (rest
// and the ends come exactly)
const BEND_NOISE = 2;
const isNoise = (raw: number, last: number) =>
  raw !== 0 && raw !== BEND_REST && raw !== BEND_MAX && Math.abs(raw - last) <= BEND_NOISE;

// a pitch bend message: 14 bits (its second byte the low 7, its third the high 7), 8192 at rest, as a share of
// the range: -1 at 0, 1 at 16383 (the range up has one step less)
export const midiBend = (lsb: number, msb: number) => {
  const bend = ((msb << 7) | lsb) - BEND_REST;
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
  // a MIDI Clock of the input leads the tempo and the position
  transport: TransportModule;
}

// the system messages of a MIDI Clock (not of a channel): a clock (24 a quarter), Start, Continue, Stop and Song
// Position (14 bits of 16ths)
const CLOCK = 0xf8;
const START = 0xfa;
const CONTINUE = 0xfb;
const STOP = 0xfc;
const SONG_POSITION = 0xf2;
// the first status of the system messages
const SYSTEM = 0xf0;

export const midiController = ({
  inputController: [{ $pressed, $bend }, { onPress, onRelease, setBend }],
  transport: [{ $source, beatAt, tempoAt, contextTimeAt }, { follow, locate, setPlaying, setSource }],
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
    // the last pitch bend this controller set, its 14 bits and its channel (the wheel on the screen sets it too)
    const bend = { value: 0, raw: BEND_REST, channel: 0 };
    // the MIDI Clock of the selected input: from its first clock it leads the tempo and the position of the
    // transport, CLOCK_LOST_MS without one (or another input) the tempo of the field leads again
    const clock = createMidiClock({
      beatAt,
      tempoAt,
      follow,
      locate,
      setPlaying,
      contextTime: (seconds) => contextTimeAt(seconds * 1000),
    });
    const lost: { timer?: number } = {};
    const loseClock = () => {
      window.clearTimeout(lost.timer);
      if ($source.value !== 'midi') return;
      clock.reset();
      setSource('internal');
    };

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
      clock,
      lost,
      loseClock,
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
        clock,
        lost,
        loseClock,
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
                .pipe(
                  // a clock and the transport, on no channel
                  filter((e) => {
                    const [status, lsb, msb] = e.data;
                    if (status < SYSTEM) return true;
                    // the moment the message came (seconds of the page)
                    const time = () => messageTime(e.timeStamp) / 1000;
                    if (status === CLOCK) {
                      setSource('midi');
                      clock.tick(time());
                      window.clearTimeout(lost.timer);
                      lost.timer = window.setTimeout(loseClock, CLOCK_LOST_MS);
                    } else if (status === START) clock.start();
                    else if (status === CONTINUE) clock.continue();
                    else if (status === STOP) clock.stop();
                    else if (status === SONG_POSITION && e.data.length === 3)
                      clock.songPosition(lsb | (msb << 7), time());
                    return false;
                  }),
                  filter((e) => e.data.length === 3)
                )
                .subscribe((e) => {
                  const [control, midi, velocity] = e.data;
                  const channel = control & 0b1111;
                  if (!acceptsChannel($selectedChannel.value, channel)) return;
                  // pitch bend: the bytes of a note are its low and high 7 bits
                  if (control >= 224 && control <= 239) {
                    const raw = (velocity << 7) | midi;
                    // (the wheel on the screen set another one since: this one plays)
                    const playing = channel === bend.channel && $bend.value === bend.value;
                    if (playing && isNoise(raw, bend.raw)) return;
                    bend.value = midiBend(midi, velocity);
                    bend.raw = raw;
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
                    onPress(note, velocity);
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
    // pitch bend back at rest: it goes back to 0 (a wheel left bent would hold the pitch; one the wheel on the
    // screen set since stays); those of a channel still listened to stay
    .subscriptions(({ $selectedInputId, $selectedChannel, held, bend }) => {
      const releaseHeld = (passes: (channel: number) => boolean) => {
        if (bend.value !== 0 && !passes(bend.channel)) {
          if ($bend.value === bend.value) setBend(0);
          bend.value = 0;
          bend.raw = BEND_REST;
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
        // another input, or none: the selected one is gone, its clock too
        $selectedInputId.pipe(distinctUntilChanged()).subscribe(() => releaseHeld(() => false)),
      ];
    })
    .subscriptions(({ $selectedInputId, loseClock }) => [
      $selectedInputId.pipe(distinctUntilChanged()).subscribe(loseClock),
    ])
    .destroy(({ $midiSubscription, loseClock }) => {
      $midiSubscription.value?.[1].unsubscribe();
      loseClock();
    });

export const { ModelProvider: MidiControllerProvider, useModel: useMidiController } = rxModelReact(
  'midiController',
  midiController
);
