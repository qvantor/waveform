import {
  asyncScheduler,
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  pairwise,
  skip,
  Subject,
  throttleTime,
} from 'rxjs';
import { isEqual } from 'lodash';
import { Note } from '@waveform/ui-kit';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { ENVELOPES, MOD_SOURCES, PITCH_BEND_DEFAULT, PITCH_BEND_MAX } from '@waveform/preset-schema';
import { getFq, stringToNote, noteToString } from '../../services';
import { urlSnapshotPlugin } from '../../../app';
import type {
  VoiceFilterOptions,
  VoiceOscOptions,
  VoiceRoute,
  VoiceStartedMessage,
  VoiceVelocity,
} from '../wavetable/voice-options';
import type { ParamAutomation, VoiceHandle } from '../wavetable/wavetable-engine';
import { EnvelopeParams, envelopeValue } from '../envelope/envelope-curve';
import { velocityAmp, velocityLevel, velocityShare } from '../envelope/velocity';
import { amountInUnits, filterTargetScale, MOD_TARGETS, ModScale } from '../modulation/modulation-targets';
import type { FilterModule } from '../../filter/modules/filter';
import type { FxNote } from '../../fx/effects/fx-modulation';
import {
  HELD_AGAIN_GATE,
  HELD_GATE,
  OSC_PARAMS,
  OscParam,
  oscParamName,
  RELEASE_GATE,
  RELEASE_LEAD,
  releaseStart,
  VoiceParam,
} from '../wavetable/wavetable-osc-params';
import { noteLfosOf } from '../../modulation/note-lfos';
import { Glide, glideFrom, scheduleGlide, steady } from './glide';
import { DEFAULT_VELOCITY, InputControllerModule } from './input-controller';
import { Envelopes, EnvelopesModule, VelocityKnobs } from './envelopes';
import type { LfoModule } from './lfos';
import { ModRoute, ModulationModule } from './modulation';
import { OscillatorModel, OscillatorModule } from './oscillator';
import { SynthCoreModule } from './synth-core';

interface Deps {
  synthCore: SynthCoreModule;
  inputController: InputControllerModule;
  envelopes: EnvelopesModule;
  lfo: LfoModule;
  modulation: ModulationModule;
  oscillator: [OscillatorModule, OscillatorModule];
  filter: FilterModule;
}

// a traced voice has started (the perf test hook times the notes): its note and the frames it was scheduled
// and started at. Voices are traced only while $voiceStarts of the model is observed
export interface VoiceStart {
  note: string;
  scheduled: number;
  started: number;
}

// seconds: the time constant a knob glides to its value on a playing note with (95% in 10 ms), it is set
// exactly after SETTLE of them (the param is constant again, the voice reads its mix table)
const SMOOTHING = 0.0033;
const SETTLE = 6;

// milliseconds: the voices node takes the pitch bend at most this often (MIDI sends hundreds of messages a
// second), the first value at once, the last one after the pause
const BEND_INTERVAL = 5;

// the cents of the pitch bend: its share (-1..1) of the range down or up (semitones)
export const bendCents = (bend: number, down: number, up: number) => 100 * (bend > 0 ? up : down) * bend;

// the range of the bend of a snapshot: whole semitones within 0..PITCH_BEND_MAX, one that isn't a number its
// default (a url snapshot skips presetDataSchema: `bd` may be anything, Infinity too, whose cents are NaN)
const bendRangeFrom = (value: unknown) =>
  typeof value === 'number' && !Number.isNaN(value)
    ? Math.round(Math.min(PITCH_BEND_MAX, Math.max(0, value)))
    : PITCH_BEND_DEFAULT;

// a knob on a playing note: no steps (crackles) from the steps of the UI
const glideParam = (param: ParamAutomation, value: number, now: number) => {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, SMOOTHING);
  param.setValueAtTime(value, now + SETTLE * SMOOTHING);
};

// at once: the octave (a glide between two octaves would chirp)
const setParam = (param: ParamAutomation, value: number, now: number) => {
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
};

type VoiceOscillator = Pick<OscillatorModel, 'id' | '$active' | '$osc' | '$unisonShape' | '$params'>;

// the options of an oscillator its processor reads at the note on (null: off): the phases and the shape of the
// unison are options, not params (an AudioParam costs every block, ~2% of a held note)
const oscOptions = ({ id, $active, $osc, $unisonShape }: VoiceOscillator): VoiceOscOptions | null => {
  if (!$active.value) return null;
  const { unison, phase, phaseRand } = $osc.value;
  return { table: id, unison, phase, phaseRand, unisonShape: $unisonShape.value };
};

// the options of an oscillator but the phases: they only start a voice (taken over, it goes on with them)
const withoutPhases = (options: VoiceOscOptions | null) => options && { ...options, phase: 0, phaseRand: 0 };

// a route of a voice: the scale in it only when not linear, bipolar only when it is
const voiceRoute = (
  source: number,
  param: string,
  amount: number,
  scale: ModScale,
  [min, max]: [number, number],
  bipolar: boolean | undefined
): VoiceRoute => ({
  source,
  param,
  amount: amountInUnits(amount, scale, [min, max]),
  min,
  max,
  ...(scale !== 'linear' && { scale }),
  ...(bipolar && { bipolar }),
});

// cents the detune of a voice is clamped to (Oct, Semi, Fine, the bend and the routes of the pitch): never in
// effect, the voice keeps the pitch of each unison voice within 0..nyquist
const DETUNE_LIMIT = 12000;

// the routes of a note to its params: of the oscillators on for it (`osc`, null: off), of the filter while it is
// on, in the range of its type (a knob its type doesn't use is left out), and to the knobs of the LFOs (Rate by its
// frequency); an amount of 0 is left out (its source isn't rendered for it). The core keeps a route per source,
// param and polarity: a source on Pitch and on Fine of one polarity is one route, its cents added
const voiceRoutes = (
  routes: ModRoute[],
  osc: (VoiceOscOptions | null)[],
  filter: VoiceFilterOptions | null
): VoiceRoute[] => {
  const merged = new Map<string, VoiceRoute>();
  routes
    .flatMap(({ source: id, target, amount, bipolar }) => {
      const definition = MOD_TARGETS[target];
      if (!definition || amount === 0) return [];
      const source = MOD_SOURCES.indexOf(id);
      if (definition.kind === 'osc') {
        if (!osc[definition.osc]) return [];
        const param = oscParamName(definition.param, definition.osc);
        const route = voiceRoute(source, param, amount, definition.scale, definition.range, bipolar);
        return [definition.unit ? { ...route, min: -DETUNE_LIMIT, max: DETUNE_LIMIT } : route];
      }
      if (definition.kind === 'lfo')
        return [voiceRoute(source, target, amount, definition.scale, definition.range, bipolar)];
      // the fx follow the last note (the fx model)
      if (definition.kind === 'fx' || !filter) return [];
      const { scale, range, disabled } = filterTargetScale(filter.type, definition.param);
      if (disabled) return [];
      return [voiceRoute(source, definition.param, amount, scale, range, bipolar)];
    })
    .forEach((route) => {
      const key = `${route.source}:${route.param}:${!!route.bipolar}`;
      const other = merged.get(key);
      merged.set(key, other ? { ...other, amount: other.amount + route.amount } : route);
    });
  return [...merged.values()].filter(({ amount }) => amount !== 0);
};

// the envelopes of a note, in legato of its phrase (its notes share them): its number (the processors find
// the phrase by it: two of them may be scheduled at the same time), ENV 1–3 (read at the note on, in legato
// at the start of the phrase), the seconds of the context time they are scheduled at (the note on of its
// first note: they don't start again) and those they started at (later when the first voice was processed
// late: it starts them at its first sample, and tells it). In mono a note that starts them again on the voice
// that sounds gives it a phrase of its own from then on, with the levels they start their attacks from
interface Phrase {
  id: number;
  envelopes: EnvelopeParams[];
  start: number;
  started: number;
  from?: number[];
}

// the key was released: the seconds of the context then and those it was held
interface Stopped {
  now: number;
  held: number;
}

// the seconds of the context the release of a voice starts at, as its processor starts it (null while the key
// is held): as long after its first sample (or its last start again: `startedAt`) as the key was held, not
// before it sees the gate (now, or its first sample if later), at most RELEASE_LEAD after it
const releaseOf = (stopped: Stopped | null, startedAt: number) =>
  stopped && releaseStart(Math.max(stopped.now, startedAt), startedAt + stopped.held, RELEASE_LEAD);

// the level of envelope `env` (ENV 1: the volume) of a phrase at `now` (seconds of the context) as the processor
// renders it: from where they started (in mono from their levels then), released at `release`
const phraseLevel = (
  { envelopes, started, from }: Phrase,
  release: number | null,
  now: number,
  env: number
) =>
  envelopeValue(envelopes[env], now - started, release === null ? Infinity : release - started, from?.[env]);

// the envelopes of a voice are those of the knobs and their curves (equal values: a preset applied again makes
// new objects)
const sameEnvelopes = (envelopes: EnvelopeParams[], knobs: Envelopes) =>
  ENVELOPES.every((id, k) => isEqual(envelopes[k], knobs[id]));

// the velocity of a note (MIDI 1..127) by the knobs of the velocity: VELO (the source of the routes after the
// envelopes) and the amp of its voice (its volume after ENV 1); its share of 127 (the dot of the chart)
interface NoteVelocity extends VoiceVelocity {
  share: number;
}
const noteVelocity = (velocity: number, { amp, k }: VelocityKnobs): NoteVelocity => {
  const level = velocityLevel(k, velocity);
  return { level, amp: velocityAmp(amp, level), share: velocityShare(velocity) };
};

// the numbers of the phrases, unique in the page (a model created again on the same context doesn't take the
// number of a voice still playing)
let phrases = 0;

interface VoiceConfig {
  audioCtx: AudioContext;
  createVoice: SynthCoreModule[0]['wavetables']['createVoice'];
  note: Note;
  // the seconds of the context time of the note on (read once: out of legato envStart is the same)
  start: number;
  oscillators: VoiceOscillator[];
  // the frequency of the note, with portamento a glide to it from the note before
  pitch: Glide;
  // its velocity
  velocity: NoteVelocity;
  // its envelopes (its own, in legato those of its phrase)
  phrase: Phrase;
  // the routes of the modulation (to its params: voiceRoutes) and the filter (null: off)
  routes: ModRoute[];
  filter: VoiceFilterOptions | null;
  // the voice has ended (released to 0, stolen, failed, or the voices node failed)
  onEnded: (voice: Voice) => void;
  // the voices node started it later than scheduled, at `startedAt` (seconds of the context): its note on came
  // after that block began
  onLate: (startedAt: number) => void;
  // traces the voice: the voices node tells the frames of its start
  onStarted?: (message: VoiceStartedMessage) => void;
  // a voice of mono (Poly 1): the notes it takes over may start its envelopes again, the voices node tells the
  // frames of its start (on time too: the voice keeps its starts again until then)
  mono: boolean;
}

// the voice of a note in the voices node: both oscillators (off: not active when it was pressed) with their
// unison voices and its envelopes (ENV 1 is its volume); the knobs are the base of its params (oscillator
// $params), the unison and its shape, the phases, on/off and the envelopes are read now
const createVoiceHandle = ({
  audioCtx,
  createVoice,
  start: now,
  oscillators,
  pitch,
  velocity: { level, amp },
  phrase: { id: phrase, envelopes, start: envStart },
  routes,
  filter,
  onStarted,
  mono,
}: VoiceConfig) => {
  const values: Partial<Record<VoiceParam, number>> = { frequency: pitch.from };
  const osc = oscillators.map((oscillator, index) => {
    const params = oscillator.$params.value;
    OSC_PARAMS.forEach((param) => (values[oscParamName(param, index)] = params[param]));
    return oscOptions(oscillator);
  });
  const handle = createVoice(
    {
      osc,
      start: now,
      envelopes,
      envStart,
      phrase,
      routes: voiceRoutes(routes, osc, filter),
      filter,
      velocity: { level, amp },
      ...(onStarted && { trace: true }),
      ...(mono && { mono: true }),
    },
    values
  );
  if (handle && pitch.seconds > 0) {
    const param = handle.params.frequency;
    param.setValueAtTime(pitch.from, now);
    scheduleGlide(param, pitch);
  }
  return handle;
};

// a note: its voice plays in the voices node, ENV 1 shapes it there and the node tells its end once ENV 1 is
// back at 0 after the release (or a stolen voice has faded out)
class Voice {
  private config: VoiceConfig;
  private handle: VoiceHandle;
  // the options of the oscillators its voice read at the note on (null: off when it was pressed)
  private osc: (VoiceOscOptions | null)[];
  // the milliseconds of the note on (performance.now): the time its key is held, currentTime moves by device
  // buffers
  private pressedAt = performance.now();
  // the seconds of the context its first sample is at: its start, later once its processor tells it started
  // late
  private startedAt: number;
  // the key was released (null while it is held)
  private stopped: Stopped | null = null;
  // its starts again (mono) until its processor tells where it started (null from then on): when, and whether
  // its key was released then; processed late, they are worked out again from its first sample
  private restarts: { at: number; stopped: Stopped | null }[] | null = [];
  // the routes its voice has (JSON): a change of the routes of other knobs sends nothing
  private routes: string;
  // the note it plays (the key it is held under; in mono the top of the stack) and the glide of its pitch to it
  note: Note;
  private pitch: Glide;
  // its envelopes: those of its note, in legato of its phrase, in mono from where a note started them again
  private current: Phrase;
  // the value of its gate while held: HELD_GATE and HELD_AGAIN_GATE in turn, another one starts the envelopes
  // again; the time it was set at (none: the value of the node)
  private heldGate = HELD_GATE;
  private heldAt = -Infinity;
  // the velocity it plays: of its note, in mono of the last note it took over
  velocity: NoteVelocity;

  // handle: from createVoiceHandle, the voicing makes a voice only for a handle
  constructor(config: VoiceConfig, handle: VoiceHandle) {
    this.config = config;
    this.handle = handle;
    this.startedAt = config.start;
    this.note = config.note;
    this.pitch = config.pitch;
    this.current = config.phrase;
    this.osc = config.oscillators.map(oscOptions);
    this.velocity = config.velocity;
    this.routes = JSON.stringify(voiceRoutes(config.routes, this.osc, config.filter));
    handle.onStarted = (started, scheduled) => {
      if (__PERF__) config.onStarted?.({ started, scheduled });
      if (started > scheduled) this.startLate(started / config.audioCtx.sampleRate);
      this.restarts = null;
    };
    handle.onEnded = () => config.onEnded(this);
  }

  // its number in the voices node
  get id() {
    return this.handle.id;
  }

  private get gate() {
    return this.handle.params.gate;
  }

  // the voices node started it at `started` (seconds of the context), later than scheduled (its note on came
  // late): its envelopes start there, the fx follow them (onLate). Its starts again before it are that start (it
  // sees the gate at its first sample), those after it start from the levels they have then from there
  private startLate(started: number) {
    this.startedAt = started;
    if (this.restarts?.length) {
      this.current = { ...this.config.phrase, started };
      for (const { at, stopped } of this.restarts) {
        if (at > started) this.startAgain(at, stopped);
      }
    }
    this.config.onLate(started);
  }

  // its envelopes start again at `at` (seconds of the context), each from the level it has there, released as
  // `stopped` (its key then) says
  private startAgain(at: number, stopped: Stopped | null) {
    const release = releaseOf(stopped, this.startedAt);
    const from = this.current.envelopes.map((_, env) => phraseLevel(this.current, release, at, env));
    this.current = { ...this.current, start: at, started: at, from };
    this.startedAt = at;
  }

  // it plays the oscillators of the knobs: on/off, the unison and its shape are read at its note on (the phases
  // only start it: taken over, it goes on with them)
  playsKnobs() {
    const knobs = this.config.oscillators.map((oscillator) => withoutPhases(oscOptions(oscillator)));
    return isEqual(this.osc.map(withoutPhases), knobs);
  }

  // mono: the voice plays `note` instead, its pitch glides there in `seconds` along the curve from where it is
  // (a glide the note interrupts goes on from its value now); 0: at once
  glide = (note: Note, seconds: number) => {
    const param = this.handle.params.frequency;
    this.note = note;
    this.pitch = glideFrom(param, this.pitch, getFq(note), this.config.audioCtx.currentTime, seconds);
  };

  // mono: a new note on the voice starts its envelopes again (out of legato, or from its release), now, each
  // from the level it has reached (no step); its release is off, the time its key is held counts from now.
  // The gate held at its other value tells its voice (automation: exact to the sample)
  retrigger = () => {
    const now = this.config.audioCtx.currentTime;
    this.restarts?.push({ at: now, stopped: this.stopped });
    this.startAgain(now, this.stopped);
    // at another value than its voice has seen: one set at this same time (two notes within a device buffer)
    // is replaced before it is seen, the value stays
    if (now !== this.heldAt) this.heldGate = this.heldGate === HELD_GATE ? HELD_AGAIN_GATE : HELD_GATE;
    this.heldAt = now;
    setParam(this.gate, this.heldGate, now);
    this.pressedAt = performance.now();
    this.stopped = null;
  };

  get phrase() {
    return this.current;
  }

  // the seconds of the context its release starts at, as its processor starts it (null while the key is held)
  get releaseAt() {
    return releaseOf(this.stopped, this.startedAt);
  }

  // the end of the release, Infinity while the note is held; released at 0 it ends there, as its processor
  get releaseEnd() {
    const at = this.releaseAt;
    if (at === null) return Infinity;
    return this.level(at) > 0 ? at + this.current.envelopes[0].release : at;
  }

  // the level of an envelope (ENV 1: the volume) at `now` (seconds of the context) as its processor renders
  // it: from the start of its phrase (its own, in legato the first note's; where they started, once processed
  // late; in mono where a note started them again, from their levels then), released at releaseAt
  level(now: number, env = 0) {
    return phraseLevel(this.current, this.releaseAt, now, env);
  }

  // its volume at `now`: ENV 1 × the amp of its velocity
  volume(now: number) {
    return this.level(now) * this.velocity.amp;
  }

  // the key is released: the release of ENV 1 starts from the level it has reached, as long after the start as
  // the key was held (a note shorter than a device buffer would see the currentTime of its note on: released
  // at its start, silent). The gate tells the voice how long (from its first sample: it may be processed late),
  // in f32 as its timeline keeps it; the fx release at that time (releaseAt). A sample after a gate held at this
  // same time (a note that started the envelopes again within this device buffer): at the same time it would
  // replace it before the voice sees it, which would release the voice from its last release (and end it sooner)
  stop = () => {
    const now = this.config.audioCtx.currentTime;
    const held = (performance.now() - this.pressedAt) / 1000;
    const at = this.heldAt === now ? now + 1 / this.config.audioCtx.sampleRate : now;
    setParam(this.gate, RELEASE_GATE + held, at);
    this.stopped = { now: at, held };
  };

  // a stolen voice: it fades out (20 ms, a raised cosine) instead of being cut
  immediatelyStop() {
    setParam(this.gate, -1, this.config.audioCtx.currentTime);
  }

  // the routes of the modulation or the type of the filter changed: the routes of its params, null when its
  // voice has them (a change of the routes of other knobs sends nothing); the voice glides into the new amounts
  nextRoutes = (routes: ModRoute[], filter: VoiceFilterOptions | null) => {
    const next = voiceRoutes(routes, this.osc, filter);
    const json = JSON.stringify(next);
    if (json === this.routes) return null;
    this.routes = json;
    return { routes: next, json };
  };

  // the knob of a param of an oscillator: the octave at once, the others glide
  setParam = (osc: number, param: OscParam, value: number) => {
    const automation = this.handle.params[oscParamName(param, osc)];
    (param === 'detune' ? setParam : glideParam)(automation, value, this.config.audioCtx.currentTime);
  };
}

type Wavetables = SynthCoreModule[0]['wavetables'];

interface VoicingContext {
  audioCtx: AudioContext;
  createVoice: Wavetables['createVoice'];
  // the routes, the filter and the velocity of playing voices changed
  setRoutes: Wavetables['setRoutes'];
  setFilter: Wavetables['setFilter'];
  setVelocity: Wavetables['setVelocity'];
  // the wavetable oscillator can play (its module is ready)
  isReady: () => boolean;

  $maxVoices: PrimitiveBS<number>;
  $legato: PrimitiveBS<boolean>;
  $portamento: PrimitiveBS<number>;
  oscillators: VoiceOscillator[];
  $envelopes: EnvelopesModule[0]['$envelopes'];
  $velocity: EnvelopesModule[0]['$velocity'];
  $routes: ModulationModule[0]['$routes'];
  // the filter the notes play now (null: off)
  voiceFilter: () => VoiceFilterOptions | null;
  // the envelopes of the last note pressed, the fx follow them (in legato those of its phrase)
  $fxNote: BehaviorSubject<FxNote | null>;
  $voiceStarts: Subject<VoiceStart>;
  // the count of the sounding voices has changed
  onCount: () => void;
}

class Voicing {
  private config: VoicingContext;
  // the voices of the held notes
  private voices: Record<string, Voice>;
  // every voice until it has ended, the released ones too: they follow the knobs
  private sounding = new Set<Voice>();
  // the released voices until they end (not the stolen ones), the oldest first: Poly counts them with the
  // held ones, a long release would pile up voices of fast playing above it
  private released: Voice[] = [];
  // legato: the notes pressed while another one is held share the envelopes of the first one, started then
  private phrase: Phrase | undefined;
  // the last note pressed: the fx follow the envelopes of its phrase until the next one, from where they
  // started; released with the release of `fxRelease` (the last note, in legato the last key of its phrase)
  private last: Voice | null = null;
  private fxRelease: Voice | null = null;
  // Poly 1 (mono): its voice and the keys held, the last one pressed on top. A note pressed while another key
  // is held takes the voice over (it glides there; in legato its envelopes go on), the key on top released
  // hands it back to the key below, the last key releases it. Null until a note in mono, after the voice ended
  // and once Poly leaves 1: the next note starts a voice
  private mono: { voice: Voice; stack: string[] } | null = null;
  // paused (a preset switch): the keys held, in the order they were pressed (in mono its stack), and those
  // pressed until resume; they start on the next preset. Null while it plays
  private waiting: string[] | null = null;
  // the velocity of each key held (or waiting): a key of the stack of mono given the voice back plays it again
  private velocities = new Map<string, number>();

  constructor(config: VoicingContext) {
    this.voices = {};
    this.config = config;
  }

  // the velocity of a key held (at the knobs of the velocity now)
  private velocityOf = (key: string) =>
    noteVelocity(this.velocities.get(key) ?? DEFAULT_VELOCITY, this.config.$velocity.value);

  // the voice of a note, null if the oscillator isn't ready (a note played meanwhile is not played later); with
  // portamento it glides from `from` (the last key held). In mono a note starts a phrase of its own: its voice
  // takes the next notes over, no other voice joins it
  private getVoice = (note: Note, from: Note | undefined): Voice | null => {
    const { audioCtx, createVoice, $legato, $portamento, $envelopes, $routes, oscillators } = this.config;
    const { voiceFilter, $voiceStarts, $maxVoices } = this.config;
    const now = audioCtx.currentTime;
    const own: Phrase = {
      id: ++phrases,
      // the knobs and the curves of their stages
      envelopes: ENVELOPES.map((id) => $envelopes.value[id]),
      start: now,
      started: now,
    };
    const mono = $maxVoices.value === 1;
    const phrase = $legato.value && !mono ? (this.phrase ??= own) : own;
    const frequency = getFq(note);

    const voiceConfig: VoiceConfig = {
      audioCtx,
      createVoice,
      note,
      start: now,
      oscillators,
      pitch:
        from && $portamento.value > 0
          ? { from: getFq(from), to: frequency, start: now, seconds: $portamento.value / 1000 }
          : steady(frequency, now),
      velocity: this.velocityOf(noteToString(note)),
      phrase,
      routes: $routes.value,
      filter: voiceFilter(),
      onStarted:
        __PERF__ && $voiceStarts.observed
          ? ({ scheduled, started }) => $voiceStarts.next({ note: noteToString(note), scheduled, started })
          : undefined,
      mono,
      onEnded: (voice) => {
        this.sounding.delete(voice);
        // the voice of mono ended by itself (its processor failed): the next note starts one
        if (this.mono?.voice === voice) this.mono = null;
        const key = noteToString(voice.note);
        // a held voice ended by itself: its key holds nothing (Poly doesn't count it, no glide from it)
        if (this.voices[key] === voice) this.letGo(key, voice);
        else if (!this.forget(voice)) return;
        this.config.onCount();
      },
      // processed late: the envelopes of the first note of a phrase started with it; the fx follow them (and
      // its release) from there while they are those of the last note (followFx changes nothing otherwise)
      onLate: (startedAt) => {
        if (phrase === own) phrase.started = startedAt;
        this.followFx();
      },
    };
    const handle = createVoiceHandle(voiceConfig);
    return handle ? new Voice(voiceConfig, handle) : null;
  };

  // the envelopes the fx follow: those of the phrase of the last note from where they started, released with
  // fxRelease; the velocity of the last note
  private followFx() {
    if (!this.last) return;
    const { envelopes, started, from } = this.last.phrase;
    const { level: velo, share: velocity } = this.last.velocity;
    const release = this.fxRelease?.releaseAt ?? null;
    // a note of the phrase, or a late voice that didn't move its start, changes nothing; a note that started
    // the envelopes again does (also at the same time), a note of another velocity too
    const note = this.config.$fxNote.value;
    if (
      note?.envelopes === envelopes &&
      note.start === started &&
      note.release === release &&
      note.from === from &&
      note.velo === velo &&
      note.velocity === velocity
    )
      return;
    this.config.$fxNote.next({ envelopes, start: started, release, from, velo, velocity });
  }

  // a released voice is no longer counted: it has ended or it is stolen; true if it was
  private forget(voice: Voice) {
    const index = this.released.indexOf(voice);
    if (index >= 0) this.released.splice(index, 1);
    return index >= 0;
  }

  // a voice above Poly is stolen (it fades out): the quietest released one at `now` (ENV 1 × the amp of its
  // velocity: the smallest step; the oldest of equal ones), else the oldest held one
  private steal(now: number) {
    if (this.released.length) {
      let quietest = 0;
      let level = Infinity;
      this.released.forEach((voice, index) => {
        const value = voice.volume(now);
        if (value < level) {
          level = value;
          quietest = index;
        }
      });
      const [released] = this.released.splice(quietest, 1);
      released.immediatelyStop();
      return;
    }
    const [key] = Object.keys(this.voices);
    this.voices[key]?.immediatelyStop();
    delete this.voices[key];
  }

  // a new voice for a note, gliding from the last key held (with `glide`); the voices above Poly are stolen
  // first (all of them when Poly went down)
  private startVoice(note: Note, glide = true) {
    const keys = Object.keys(this.voices);
    const from = glide && keys.length > 0 ? stringToNote(keys[keys.length - 1]) : undefined;
    const now = this.config.audioCtx.currentTime;
    while (this.voicesCount > 0 && this.voicesCount >= this.config.$maxVoices.value) this.steal(now);
    const voice = this.getVoice(note, from);
    if (!voice) return null;
    this.voices[noteToString(note)] = voice;
    this.sounding.add(voice);
    this.followNote(voice);
    return voice;
  }

  // the fx follow the envelopes of `voice` from now (a new note), until its release
  private followNote(voice: Voice) {
    this.last = voice;
    this.fxRelease = null;
    this.followFx();
  }

  // mono: the voice takes over `note`, the key on top of the stack. While another key was held (`held`) it
  // glides there from where it is, in legato its envelopes go on, else they start again; from its release it
  // plays it at once (Always is off) and they start again. False when a new voice plays it: its release ends
  // before its processor would see the gate (it would have ended), or its envelopes would start again as
  // others than the knobs' or with other oscillators (on/off, the unison and its shape; its processor reads them
  // at its note on; a glide in legato keeps it)
  private takeOver(note: Note, held: boolean) {
    const { mono } = this;
    if (!mono) return false;
    const { voice } = mono;
    const again = !held || !this.config.$legato.value;
    if (voice.releaseEnd <= this.config.audioCtx.currentTime + RELEASE_LEAD) return false;
    if (again && !(sameEnvelopes(voice.phrase.envelopes, this.config.$envelopes.value) && voice.playsKnobs()))
      return false;
    delete this.voices[noteToString(voice.note)];
    this.voices[noteToString(note)] = voice;
    this.forget(voice);
    voice.glide(note, held ? this.config.$portamento.value / 1000 : 0);
    this.takeVelocity(voice, noteToString(note));
    if (!again) {
      // in legato a note for the fx only by its velocity
      this.followFx();
      return true;
    }
    // a new note for the fx: from now, from the levels of the envelopes
    voice.retrigger();
    this.followNote(voice);
    return true;
  }

  // mono: the voice plays the velocity of `key` now (VELO and its amp glide there in 10 ms)
  private takeVelocity(voice: Voice, key: string) {
    const velocity = this.velocityOf(key);
    const { level, amp } = velocity;
    const same = level === voice.velocity.level && amp === voice.velocity.amp;
    voice.velocity = velocity;
    if (!same) this.config.setVelocity([voice.id], { level, amp });
  }

  // mono: `note` on top of `stack`, its voice takes it over, else a new voice plays it
  private playMono(note: Note, held: boolean, stack: string[]) {
    if (this.takeOver(note, held)) return;
    const voice = this.startVoice(note);
    this.mono = voice && { voice, stack };
  }

  // a note played before the oscillator is ready is not played (nor later); paused, it waits for resume (at its
  // velocity)
  onPress = (note: Note, velocity = DEFAULT_VELOCITY) => {
    this.velocities.set(noteToString(note), velocity);
    if (this.waiting) {
      const key = noteToString(note);
      if (!this.waiting.includes(key)) this.waiting.push(key);
      return;
    }
    if (!this.config.isReady()) return;
    // the released voices whose release is over are not counted (their ended message is on its way)
    const now = this.config.audioCtx.currentTime;
    this.released = this.released.filter((voice) => voice.releaseEnd > now);
    if (this.config.$maxVoices.value !== 1) {
      this.startVoice(note);
      return;
    }
    // mono: the key goes on top of the stack (pressed again, from where it was)
    const key = noteToString(note);
    const stack = this.mono?.stack.filter((item) => item !== key) ?? [];
    const held = stack.length > 0;
    stack.push(key);
    if (this.mono) this.mono.stack = stack;
    this.playMono(note, held, stack);
  };

  onRelease = (note: Note) => {
    const stringNote = noteToString(note);
    this.velocities.delete(stringNote);
    if (this.waiting) {
      this.waiting = this.waiting.filter((key) => key !== stringNote);
      return;
    }
    const { mono } = this;
    const index = mono ? mono.stack.indexOf(stringNote) : -1;
    if (mono && index >= 0) {
      mono.stack.splice(index, 1);
      // a key below the top: the voice plays on
      if (index < mono.stack.length) return;
      // the key on top: the voice goes back to the key below as if it were pressed, the last key releases it
      const top = mono.stack[mono.stack.length - 1];
      if (top !== undefined) {
        this.playMono(stringToNote(top), true, mono.stack);
        return;
      }
    }
    const voice = this.voices[stringNote];
    // the voice of a stolen note has already stopped (or it ended by itself), the held ones keep playing
    if (!voice) return;
    this.letGo(stringNote, voice);
    this.released.push(voice);
  };

  // the voice of a held key no longer plays it: its key is released, or it ended by itself (its node is off, the
  // release only tells the fx when)
  private letGo(key: string, voice: Voice) {
    voice.stop();
    delete this.voices[key];
    const held = Object.keys(this.voices).length;
    // the fx release their envelopes with the last note (at its release), in legato with the last key of the
    // phrase
    if (this.last && (this.phrase ? held === 0 : voice === this.last)) {
      this.fxRelease = voice;
      this.followFx();
    }
    // the last key of a legato phrase: the next note starts a new one
    if (held === 0) this.phrase = undefined;
  }

  // Poly came to 1 or left it: the voice of mono plays on as a voice of its note (its other keys release
  // nothing), the next note follows the new mode
  leaveMono() {
    this.mono = null;
    this.phrase = undefined;
  }

  // a preset switch: every voice fades out (20 ms, as a stolen one), the fx follow no note; the keys held wait
  // for resume, with those pressed meanwhile (a voice now would play the tables of the preset before)
  pause() {
    if (this.waiting) return;
    this.waiting = this.mono ? [...this.mono.stack] : Object.keys(this.voices);
    this.sounding.forEach((voice) => voice.immediatelyStop());
    this.voices = {};
    this.released = [];
    this.mono = null;
    this.phrase = undefined;
    this.last = null;
    this.fxRelease = null;
    this.config.$fxNote.next(null);
    this.config.onCount();
  }

  // the next preset is ready: the keys still held start on it as pressed together (no glide between them), in
  // its mode (in mono the last one pressed, the others under it); none before the oscillator is ready
  resume() {
    const keys = this.waiting;
    this.waiting = null;
    if (!keys?.length || !this.config.isReady()) return;
    if (this.config.$maxVoices.value !== 1) keys.forEach((key) => this.startVoice(stringToNote(key), false));
    else this.playMono(stringToNote(keys[keys.length - 1]), false, keys);
    this.config.onCount();
  }

  // every voice has ended (its processor posted it): a preset switch waits for those it faded out
  get silent() {
    return this.sounding.size === 0;
  }

  // the sounding voices: held and released, the stolen ones fade out uncounted
  get voicesCount() {
    return Object.keys(this.voices).length + this.released.length;
  }

  setParam = (osc: number, param: OscParam, value: number) =>
    this.sounding.forEach((voice) => voice.setParam(osc, param, value));

  // the voices whose routes changed, one event for each set of routes
  setRoutes = (routes: ModRoute[], filter: VoiceFilterOptions | null) => {
    const changed = new Map<string, { routes: VoiceRoute[]; voices: number[] }>();
    this.sounding.forEach((voice) => {
      const next = voice.nextRoutes(routes, filter);
      if (!next) return;
      const same = changed.get(next.json) ?? { routes: next.routes, voices: [] };
      same.voices.push(voice.id);
      changed.set(next.json, same);
    });
    changed.forEach(({ routes: next, voices }) => this.config.setRoutes(voices, next));
  };

  // the knobs of the filter changed (null: off): the voices glide to them
  setFilter = (filter: VoiceFilterOptions | null) =>
    this.config.setFilter(
      [...this.sounding].map((voice) => voice.id),
      filter
    );
}

export const synth = ({
  synthCore: [{ audioCtx, wavetables }],
  inputController: [{ $onPress, $onRelease, $bend }],
  envelopes: [{ $envelopes, $velocity }],
  lfo,
  modulation: [{ $routes }],
  oscillator: oscillators,
  filter: [{ voiceFilter, $voiceFilter }],
}: Deps) =>
  rxModel(() => {
    const $maxVoices = new PrimitiveBS<number>(8);
    const $portamento = new PrimitiveBS<number>(0);
    const $legato = new PrimitiveBS<boolean>(false);
    // the range of the pitch bend: semitones down and up
    const $bendDown = new PrimitiveBS<number>(PITCH_BEND_DEFAULT);
    const $bendUp = new PrimitiveBS<number>(PITCH_BEND_DEFAULT);
    const $voicesCount = new PrimitiveBS<number>(0);
    const $fxNote = new BehaviorSubject<FxNote | null>(null);
    const $voiceStarts = new Subject<VoiceStart>();

    // move to another module
    const voicingContext: VoicingContext = {
      audioCtx,
      createVoice: wavetables.createVoice,
      setRoutes: wavetables.setRoutes,
      setFilter: wavetables.setFilter,
      setVelocity: wavetables.setVelocity,
      isReady: () => wavetables.$status.value === 'ready',
      $maxVoices,
      $legato,
      $portamento,
      $envelopes,
      $velocity,
      $routes,
      voiceFilter,
      $fxNote,
      $voiceStarts,
      oscillators: oscillators.map(([osc]) => osc),
      onCount: () => $voicesCount.next(voicing.voicesCount),
    };
    const voicing = new Voicing(voicingContext);
    // the LFOs of the last note on the main thread (the marks of the knobs, the chart of an LFO)
    const noteLfos = noteLfosOf(audioCtx.sampleRate, lfo, $fxNote, $routes);

    return {
      $maxVoices,
      $portamento,
      $legato,
      $bendDown,
      $bendUp,
      $voicesCount,
      $fxNote,
      $voiceStarts,
      voicing,
      noteLfos: noteLfos.lfos,
      followNoteLfos: noteLfos.follow,
    };
  })
    .actions(({ $maxVoices, $portamento, $legato, $bendDown, $bendUp, $voicesCount, voicing }) => ({
      setMaxVoices: (value: number) => $maxVoices.next(value),
      setPortamento: (value: number) => $portamento.next(value),
      setLegato: (value: boolean) => $legato.next(value),
      setBendDown: (value: number) => $bendDown.next(value),
      setBendUp: (value: number) => $bendUp.next(value),
      setVoicesCount: (value: number) => $voicesCount.next(value),
      // a preset switch (soundSwitch): silence, the keys wait for the next preset; it is ready: they start on it
      pause: () => voicing.pause(),
      resume: () => voicing.resume(),
    }))
    .subscriptions(({ voicing, $maxVoices, $bendDown, $bendUp, followNoteLfos }, { setVoicesCount }) => [
      ...followNoteLfos(),
      $onRelease.subscribe((note) => {
        voicing.onRelease(note);

        setVoicesCount(voicing.voicesCount);
      }),
      $onPress.subscribe(({ note, velocity }) => {
        voicing.onPress(note, velocity);
        setVoicesCount(voicing.voicesCount);
      }),
      // Poly comes to 1 or leaves it while notes play
      $maxVoices
        .pipe(
          map((max) => max === 1),
          distinctUntilChanged(),
          skip(1)
        )
        .subscribe(() => voicing.leaveMono()),
      // the playing notes follow the routes (their amounts glide) and the filter: its knobs glide, its type and
      // on/off change the routes of the filter
      $routes.pipe(skip(1)).subscribe((routes) => voicing.setRoutes(routes, voiceFilter())),
      $voiceFilter.pipe(skip(1)).subscribe((filter) => {
        voicing.setFilter(filter);
        voicing.setRoutes($routes.value, filter);
      }),
      // the pitch bend of every note, in the voices node (on top of the detune of each oscillator, it glides
      // there; new notes start with it), at most every BEND_INTERVAL
      combineLatest([$bend, $bendDown, $bendUp])
        .pipe(
          map(([bend, down, up]) => bendCents(bend, down, up)),
          distinctUntilChanged(),
          skip(1),
          throttleTime(BEND_INTERVAL, asyncScheduler, { leading: true, trailing: true })
        )
        .subscribe((cents) => wavetables.setBend(cents)),
      // the playing notes follow the knobs (the base of the params of each oscillator)
      ...oscillators.map(([{ $params }], osc) =>
        $params.pipe(pairwise()).subscribe(([previous, params]) =>
          OSC_PARAMS.forEach((param) => {
            if (params[param] !== previous[param]) voicing.setParam(osc, param, params[param]);
          })
        )
      ),
    ])
    .plugins(
      urlSnapshotPlugin({
        prefix: 'v',
        modelToSnap: ({ $legato, $portamento, $maxVoices, $bendDown, $bendUp }) => {
          return {
            leg: $legato.value,
            port: $portamento.value,
            max: $maxVoices.value,
            bd: $bendDown.value,
            bu: $bendUp.value,
          };
        },
        applySnap: (snap, { $legato, $portamento, $maxVoices, $bendDown, $bendUp }) => {
          snap.leg !== undefined && $legato.next(snap.leg);
          snap.port !== undefined && $portamento.next(snap.port);
          snap.max !== undefined && $maxVoices.next(snap.max);
          snap.bd !== undefined && $bendDown.next(bendRangeFrom(snap.bd));
          snap.bu !== undefined && $bendUp.next(bendRangeFrom(snap.bu));
        },
      })
    );

export const {
  ModelProvider: SynthProvider,
  useModel: useSynth,
  Context: SynthContext,
} = rxModelReact('synth', synth);

export type SynthModule = ReturnType<typeof useSynth>;
