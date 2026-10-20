import { BehaviorSubject, distinctUntilChanged, map, pairwise, skip, Subject } from 'rxjs';
import { isEqual } from 'lodash';
import { Note } from '@waveform/ui-kit';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { ENVELOPES, MOD_SOURCES } from '@waveform/preset-schema';
import { getFq, stringToNote, noteToString } from '../../services';
import { urlSnapshotPlugin } from '../../../app';
import type { VoiceEndedMessage, VoiceOscOptions, VoiceStartedMessage } from '../wavetable/wavetable-osc-dsp';
import { EnvelopeParams, envelopeValue } from '../envelope/envelope-curve';
import type { VoiceRoute, VoiceRoutesMessage } from '../wavetable/voice-modulation';
import type { VoiceFilterMessage, VoiceFilterOptions } from '../wavetable/voice-filter';
import { amountInUnits, filterTargetScale, MOD_TARGETS } from '../modulation/modulation-targets';
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
import { Glide, glideFrom, scheduleGlide, steady } from './glide';
import { InputControllerModule } from './input-controller';
import { Envelopes, EnvelopesModule } from './envelopes';
import { ModRoute, ModulationModule } from './modulation';
import { OscillatorModel, OscillatorModule } from './oscillator';
import { SynthCoreModule } from './synth-core';

interface Deps {
  synthCore: SynthCoreModule;
  inputController: InputControllerModule;
  envelopes: EnvelopesModule;
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

// a knob on a playing note: no steps (crackles) from the steps of the UI
const glideParam = (param: AudioParam, value: number, now: number) => {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, SMOOTHING);
  param.setValueAtTime(value, now + SETTLE * SMOOTHING);
};

// at once: the octave (a glide between two octaves would chirp)
const setParam = (param: AudioParam, value: number, now: number) => {
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
};

type VoiceOscillator = Pick<OscillatorModel, 'id' | '$active' | '$osc' | '$params' | 'buses' | '$busSources'>;

// the routes of a note to its params: of the oscillators on for it and of the filter while it is on, in the
// range of its type (a knob its type doesn't use is left out); an amount of 0 is left out (its envelope isn't
// rendered for it)
const voiceRoutes = (routes: ModRoute[], on: boolean[], filter: VoiceFilterOptions | null): VoiceRoute[] =>
  routes.flatMap(({ source, target, amount }) => {
    const definition = MOD_TARGETS[target];
    if (!definition || amount === 0) return [];
    const env = MOD_SOURCES.indexOf(source);
    if (definition.kind === 'osc') {
      if (!on[definition.osc]) return [];
      const [min, max] = definition.range;
      const param = oscParamName(definition.param, definition.osc);
      return [{ env, param, amount: amountInUnits(amount, definition.scale, definition.range), min, max }];
    }
    // the fx follow the last note (the fx model)
    if (definition.kind === 'fx' || !filter) return [];
    const { scale, range, disabled } = filterTargetScale(filter.type, definition.param);
    if (disabled) return [];
    const [min, max] = range;
    const route: VoiceRoute = {
      env,
      param: definition.param,
      amount: amountInUnits(amount, scale, range),
      min,
      max,
    };
    return [scale === 'log' ? { ...route, log: true } : route];
  });

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

// the envelopes of a voice are those of the knobs (equal values: a preset applied again makes new objects)
const sameEnvelopes = (envelopes: EnvelopeParams[], knobs: Envelopes) =>
  ENVELOPES.every((id, k) => isEqual(envelopes[k], knobs[id]));

// the numbers of the phrases, unique in the page (a model created again on the same context doesn't take the
// number of a voice still playing)
let phrases = 0;

interface VoiceConfig {
  audioCtx: AudioContext;
  createNode: SynthCoreModule[0]['wavetables']['createVoice'];
  outputNode: AudioNode;
  note: Note;
  // the seconds of the context time of the note on (read once: out of legato envStart is the same)
  start: number;
  oscillators: VoiceOscillator[];
  // the frequency of the note, with portamento a glide to it from the note before
  pitch: Glide;
  // its envelopes (its own, in legato those of its phrase)
  phrase: Phrase;
  // the routes of the modulation (to its params: voiceRoutes) and the filter (null: off)
  routes: ModRoute[];
  filter: VoiceFilterOptions | null;
  // the voice has ended: its node is off the graph
  onEnded: (voice: Voice) => void;
  // its processor started it later than scheduled, at `startedAt` (seconds of the context): its node came
  // after that block began
  onLate: (startedAt: number) => void;
  // traces the voice: its processor posts the frames of its start
  onStarted?: (message: VoiceStartedMessage) => void;
}

// the node of a note: both oscillators (off: not active when it was pressed) with their unison voices and its
// envelopes (ENV 1 is its volume); the knobs are the base of its params (oscillator $params), the unison, the
// phases, on/off and the envelopes are read now
const createVoiceNode = ({
  audioCtx,
  createNode,
  start: now,
  oscillators,
  pitch,
  phrase: { id: phrase, envelopes, start: envStart },
  routes,
  filter,
  onStarted,
}: VoiceConfig) => {
  const parameterData: Partial<Record<VoiceParam, number>> = { frequency: pitch.from };
  const osc = oscillators.map((oscillator, index): VoiceOscOptions | null => {
    const params = oscillator.$params.value;
    OSC_PARAMS.forEach((param) => (parameterData[oscParamName(param, index)] = params[param]));
    if (!oscillator.$active.value) return null;
    // the phases at the note on: options, not params (an AudioParam costs every block, ~2% of a held note)
    const { unison, phase, phaseRand } = oscillator.$osc.value;
    return { table: oscillator.id, unison, phase, phaseRand };
  });
  const on = oscillators.map(({ $active }) => $active.value);
  const node = createNode(
    {
      osc,
      start: now,
      envelopes,
      envStart,
      phrase,
      routes: voiceRoutes(routes, on, filter),
      filter,
      ...(onStarted && { trace: true }),
    },
    parameterData
  );
  if (node && pitch.seconds > 0) {
    const param = node.parameters.get('frequency') as AudioParam;
    param.setValueAtTime(pitch.from, now);
    scheduleGlide(param, pitch);
  }
  return node;
};

// a note: its node plays into the output, its processor shapes it with ENV 1 and posts `ended` once ENV 1 is
// back at 0 after the release (or a stolen voice has faded out)
class Voice {
  private config: VoiceConfig;
  private node: AudioWorkletNode;
  // the mod buses connected to the params of the node (of the oscillators on for the note), by osc and param
  private links = new Map<string, () => void>();
  // the oscillators on when the note was pressed
  private on: boolean[];
  // the milliseconds of the note on (performance.now): the time its key is held, currentTime moves by device
  // buffers
  private pressedAt = performance.now();
  // the seconds of the context its first sample is at: its start, later once its processor tells it started
  // late
  private startedAt: number;
  // the key was released: the seconds of the context then and those it was held
  private stopped: { now: number; held: number } | null = null;
  // the routes its processor has (JSON): a change of the routes of other knobs sends nothing
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

  // node: from createVoiceNode, the voicing creates a voice only for a node. Global sources (an LFO) come
  // through the mod buses of the oscillators
  constructor(config: VoiceConfig, node: AudioWorkletNode) {
    this.config = config;
    this.node = node;
    this.startedAt = config.start;
    this.note = config.note;
    this.pitch = config.pitch;
    this.current = config.phrase;
    this.on = config.oscillators.map(({ $active }) => $active.value);
    this.routes = JSON.stringify(voiceRoutes(config.routes, this.on, config.filter));
    node.connect(config.outputNode);
    config.oscillators.forEach((oscillator, osc) =>
      OSC_PARAMS.forEach((param) => this.setBus(osc, param, oscillator.$busSources.value[param] > 0))
    );
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      node.disconnect();
      this.links.forEach((disconnect) => disconnect());
      this.links.clear();
      config.onEnded(this);
    };
    node.port.onmessage = ({ data }: MessageEvent<VoiceEndedMessage | VoiceStartedMessage>) => {
      if ('started' in data) {
        if (__PERF__) config.onStarted?.(data);
        // (a note that started its envelopes again before it is later still)
        if (data.started > data.scheduled) {
          this.startedAt = Math.max(this.startedAt, data.started / config.audioCtx.sampleRate);
          config.onLate(this.startedAt);
        }
      } else if (data.ended) end();
    };
    // its processor failed outside process() (an error in process() ends the voice there): it never ends
    node.onprocessorerror = (event) => {
      console.error('A voice of the wavetable oscillator failed', event);
      end();
    };
  }

  // connects the mod bus of a param while a source plays into it
  setBus = (osc: number, param: OscParam, used: boolean) => {
    const oscillator = this.config.oscillators[osc];
    const key = oscParamName(param, osc);
    const linked = this.links.get(key);
    if (used === Boolean(linked) || !this.on[osc]) return;
    if (linked) {
      linked();
      this.links.delete(key);
      return;
    }
    const bus = oscillator.buses[param];
    const audioParam = this.node.parameters.get(key) as AudioParam;
    bus.connect(audioParam);
    this.links.set(key, () => bus.disconnect(audioParam));
  };

  private get gate() {
    return this.node.parameters.get('gate') as AudioParam;
  }

  // mono: the voice plays `note` instead, its pitch glides there in `seconds` along the curve from where it is
  // (a glide the note interrupts goes on from its value now); 0: at once
  glide = (note: Note, seconds: number) => {
    const param = this.node.parameters.get('frequency') as AudioParam;
    this.note = note;
    this.pitch = glideFrom(param, this.pitch, getFq(note), this.config.audioCtx.currentTime, seconds);
  };

  // mono: a new note on the voice starts its envelopes again (out of legato, or from its release), now, each
  // from the level it has reached (no step); its release is off, the time its key is held counts from now.
  // The gate held at its other value tells its processor (automation: exact to the sample)
  retrigger = () => {
    const now = this.config.audioCtx.currentTime;
    const from = this.current.envelopes.map((_, env) => this.level(now, env));
    // at another value than its processor has seen: one set at this same time (two notes within a device
    // buffer) is replaced before it is seen, the value stays
    if (now !== this.heldAt) this.heldGate = this.heldGate === HELD_GATE ? HELD_AGAIN_GATE : HELD_GATE;
    this.heldAt = now;
    setParam(this.gate, this.heldGate, now);
    this.current = { ...this.current, start: now, started: now, from };
    this.pressedAt = performance.now();
    this.startedAt = now;
    this.stopped = null;
  };

  get phrase() {
    return this.current;
  }

  // the seconds of the context its release starts at, as its processor starts it (null while the key is
  // held): as long after its first sample as the key was held, not before it sees the gate (now, or its first
  // sample if later), at most RELEASE_LEAD after it
  get releaseAt() {
    if (!this.stopped) return null;
    const { now, held } = this.stopped;
    return releaseStart(Math.max(now, this.startedAt), this.startedAt + held, RELEASE_LEAD);
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
    const { envelopes, started, from } = this.current;
    const at = this.releaseAt;
    return envelopeValue(envelopes[env], now - started, at === null ? Infinity : at - started, from?.[env]);
  }

  // the key is released: the release of ENV 1 starts from the level it has reached, as long after the start as
  // the key was held (a note shorter than a device buffer would see the currentTime of its note on: released
  // at its start, silent). The gate tells the processor how long (from the first sample of the voice: it may
  // be processed late), the fx release at that time (releaseAt). A sample after a gate held at this same time
  // (a note that started the envelopes again within this device buffer): at the same time it would replace it
  // before its processor sees it, which would release the voice from its last release (and end it sooner)
  stop = () => {
    const now = this.config.audioCtx.currentTime;
    const held = (performance.now() - this.pressedAt) / 1000;
    const at = this.heldAt === now ? now + 1 / this.config.audioCtx.sampleRate : now;
    setParam(this.gate, RELEASE_GATE + held, at);
    this.stopped = { now: at, held };
  };

  // a stolen voice: its node fades out (20 ms, a raised cosine) instead of being cut
  immediatelyStop() {
    setParam(this.gate, -1, this.config.audioCtx.currentTime);
  }

  // the knobs of the filter changed (null: off): the processor glides to them
  setFilter = (filter: VoiceFilterOptions | null) => {
    const message: VoiceFilterMessage = { filter };
    this.node.port.postMessage(message);
  };

  // the routes of the modulation or the type of the filter changed: the processor glides into the new amounts
  setRoutes = (routes: ModRoute[], filter: VoiceFilterOptions | null) => {
    const message: VoiceRoutesMessage = { routes: voiceRoutes(routes, this.on, filter) };
    const json = JSON.stringify(message.routes);
    if (json === this.routes) return;
    this.routes = json;
    this.node.port.postMessage(message);
  };

  // the knob of a param of an oscillator: the octave at once, the others glide
  setParam = (osc: number, param: OscParam, value: number) => {
    const audioParam = this.node.parameters.get(oscParamName(param, osc)) as AudioParam;
    (param === 'detune' ? setParam : glideParam)(audioParam, value, this.config.audioCtx.currentTime);
  };
}

interface VoicingContext {
  audioCtx: AudioContext;
  outputNode: AudioNode;
  createNode: SynthCoreModule[0]['wavetables']['createVoice'];
  // the wavetable oscillator can play (its module is ready)
  isReady: () => boolean;

  $maxVoices: PrimitiveBS<number>;
  $legato: PrimitiveBS<boolean>;
  $portamento: PrimitiveBS<number>;
  oscillators: VoiceOscillator[];
  $envelopes: EnvelopesModule[0]['$envelopes'];
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
  // every voice until it has ended, the released ones too: they follow the knobs, and their nodes stay
  // referenced (WebKit collects an AudioWorkletNode JS no longer holds, even while it plays)
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

  constructor(config: VoicingContext) {
    this.voices = {};
    this.config = config;
  }

  // the voice of a note, null if the oscillator isn't ready (a note played meanwhile is not played later); with
  // portamento it glides from `from` (the last key held). In mono a note starts a phrase of its own: its voice
  // takes the next notes over, no other voice joins it
  private getVoice = (note: Note, from: Note | undefined): Voice | null => {
    const { audioCtx, outputNode, createNode, $legato, $portamento, $envelopes, $routes, oscillators } =
      this.config;
    const { voiceFilter, $voiceStarts, $maxVoices } = this.config;
    const now = audioCtx.currentTime;
    const own: Phrase = {
      id: ++phrases,
      envelopes: ENVELOPES.map((id) => $envelopes.value[id]),
      start: now,
      started: now,
    };
    const phrase = $legato.value && $maxVoices.value !== 1 ? (this.phrase ??= own) : own;
    const frequency = getFq(note);

    const voiceConfig: VoiceConfig = {
      audioCtx,
      createNode,
      outputNode,
      note,
      start: now,
      oscillators,
      pitch:
        from && $portamento.value > 0
          ? { from: getFq(from), to: frequency, start: now, seconds: $portamento.value / 1000 }
          : steady(frequency, now),
      phrase,
      routes: $routes.value,
      filter: voiceFilter(),
      onStarted:
        __PERF__ && $voiceStarts.observed
          ? ({ scheduled, started }) => $voiceStarts.next({ note: noteToString(note), scheduled, started })
          : undefined,
      onEnded: (voice) => {
        this.sounding.delete(voice);
        // the voice of mono ended by itself (its processor failed): the next note starts one
        if (this.mono?.voice === voice) this.mono = null;
        if (this.forget(voice)) this.config.onCount();
      },
      // processed late: the envelopes of the first note of a phrase started with it; the fx follow them (and
      // its release) from there while they are those of the last note
      onLate: (startedAt) => {
        if (phrase === own) phrase.started = startedAt;
        if (phrase === this.last?.phrase) this.followFx();
      },
    };
    const node = createVoiceNode(voiceConfig);
    return node ? new Voice(voiceConfig, node) : null;
  };

  // the envelopes the fx follow: those of the phrase of the last note from where they started, released with
  // fxRelease
  private followFx() {
    if (!this.last) return;
    const { envelopes, started, from } = this.last.phrase;
    const release = this.fxRelease?.releaseAt ?? null;
    // a note of the phrase, or a late voice that didn't move its start, changes nothing; a note that started
    // the envelopes again does (also at the same time)
    const note = this.config.$fxNote.value;
    if (
      note?.envelopes === envelopes &&
      note.start === started &&
      note.release === release &&
      note.from === from
    )
      return;
    this.config.$fxNote.next({ envelopes, start: started, release, from });
  }

  // a released voice is no longer counted: it has ended or it is stolen; true if it was
  private forget(voice: Voice) {
    const index = this.released.indexOf(voice);
    if (index >= 0) this.released.splice(index, 1);
    return index >= 0;
  }

  // a voice above Poly is stolen (it fades out): the quietest released one at `now` (the smallest step; the
  // oldest of equal ones), else the oldest held one
  private steal(now: number) {
    if (this.released.length) {
      let quietest = 0;
      let level = Infinity;
      this.released.forEach((voice, index) => {
        const value = voice.level(now);
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

  // a new voice for a note, gliding from the last key held; the voices above Poly are stolen first (all of
  // them when Poly went down)
  private startVoice(note: Note) {
    const keys = Object.keys(this.voices);
    const from = keys.length > 0 ? stringToNote(keys[keys.length - 1]) : undefined;
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
  // others than the knobs' (its processor reads them at its note on)
  private takeOver(note: Note, held: boolean) {
    const { mono } = this;
    if (!mono) return false;
    const { voice } = mono;
    const again = !held || !this.config.$legato.value;
    if (voice.releaseEnd <= this.config.audioCtx.currentTime + RELEASE_LEAD) return false;
    if (again && !sameEnvelopes(voice.phrase.envelopes, this.config.$envelopes.value)) return false;
    delete this.voices[noteToString(voice.note)];
    this.voices[noteToString(note)] = voice;
    this.forget(voice);
    voice.glide(note, held ? this.config.$portamento.value / 1000 : 0);
    if (!again) return true;
    // a new note for the fx: from now, from the levels of the envelopes
    voice.retrigger();
    this.followNote(voice);
    return true;
  }

  // mono: `note` on top of `stack`, its voice takes it over, else a new voice plays it
  private playMono(note: Note, held: boolean, stack: string[]) {
    if (this.takeOver(note, held)) return;
    const voice = this.startVoice(note);
    this.mono = voice && { voice, stack };
  }

  // a note played before the oscillator is ready is not played (nor later)
  onPress = (note: Note) => {
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
    // the voice of a stolen note has already stopped, the held ones keep playing
    if (!voice) return;
    voice.stop();
    delete this.voices[stringNote];
    this.released.push(voice);
    const held = Object.keys(this.voices).length;
    // the fx release their envelopes with the last note (at its release), in legato with the last key of the
    // phrase
    if (this.last && (this.phrase ? held === 0 : voice === this.last)) {
      this.fxRelease = voice;
      this.followFx();
    }
    // the last key of a legato phrase: the next note starts a new one
    if (held === 0) this.phrase = undefined;
  };

  // Poly came to 1 or left it: the voice of mono plays on as a voice of its note (its other keys release
  // nothing), the next note follows the new mode
  leaveMono() {
    this.mono = null;
    this.phrase = undefined;
  }

  // the sounding voices: held and released, the stolen ones fade out uncounted
  get voicesCount() {
    return Object.keys(this.voices).length + this.released.length;
  }

  setParam = (osc: number, param: OscParam, value: number) =>
    this.sounding.forEach((voice) => voice.setParam(osc, param, value));

  setBus = (osc: number, param: OscParam, used: boolean) =>
    this.sounding.forEach((voice) => voice.setBus(osc, param, used));

  setRoutes = (routes: ModRoute[], filter: VoiceFilterOptions | null) =>
    this.sounding.forEach((voice) => voice.setRoutes(routes, filter));

  setFilter = (filter: VoiceFilterOptions | null) =>
    this.sounding.forEach((voice) => voice.setFilter(filter));
}

export const synth = ({
  synthCore: [{ audioCtx, preGain, wavetables }],
  inputController: [{ $onPress, $onRelease }],
  envelopes: [{ $envelopes }],
  modulation: [{ $routes }],
  oscillator: oscillators,
  filter: [{ voiceFilter, $voiceFilter }],
}: Deps) =>
  rxModel(() => {
    const $maxVoices = new PrimitiveBS<number>(8);
    const $portamento = new PrimitiveBS<number>(0);
    const $legato = new PrimitiveBS<boolean>(false);
    const $voicesCount = new PrimitiveBS<number>(0);
    const $fxNote = new BehaviorSubject<FxNote | null>(null);
    const $voiceStarts = new Subject<VoiceStart>();

    // move to another module
    const voicingContext: VoicingContext = {
      audioCtx,
      outputNode: preGain,
      createNode: wavetables.createVoice,
      isReady: () => wavetables.$status.value === 'ready',
      $maxVoices,
      $legato,
      $portamento,
      $envelopes,
      $routes,
      voiceFilter,
      $fxNote,
      $voiceStarts,
      oscillators: oscillators.map(([osc]) => osc),
      onCount: () => $voicesCount.next(voicing.voicesCount),
    };
    const voicing = new Voicing(voicingContext);

    return { $maxVoices, $portamento, $legato, $voicesCount, $fxNote, $voiceStarts, voicing };
  })
    .actions(({ $maxVoices, $portamento, $legato, $voicesCount }) => ({
      setMaxVoices: (value: number) => $maxVoices.next(value),
      setPortamento: (value: number) => $portamento.next(value),
      setLegato: (value: boolean) => $legato.next(value),
      setVoicesCount: (value: number) => $voicesCount.next(value),
    }))
    .subscriptions(({ voicing, $maxVoices }, { setVoicesCount }) => [
      $onRelease.subscribe((note) => {
        voicing.onRelease(note);

        setVoicesCount(voicing.voicesCount);
      }),
      $onPress.subscribe((note) => {
        voicing.onPress(note);
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
      // a mod bus that gets its first source or loses its last one: the playing notes connect it or let it go
      ...oscillators.map(([{ $busSources }], osc) =>
        $busSources.pipe(pairwise()).subscribe(([previous, sources]) =>
          OSC_PARAMS.forEach((param) => {
            if (previous[param] > 0 !== sources[param] > 0) voicing.setBus(osc, param, sources[param] > 0);
          })
        )
      ),
      // the playing notes follow the routes (their amounts glide) and the filter: its knobs glide, its type and
      // on/off change the routes of the filter
      $routes.pipe(skip(1)).subscribe((routes) => voicing.setRoutes(routes, voiceFilter())),
      $voiceFilter.pipe(skip(1)).subscribe((filter) => {
        voicing.setFilter(filter);
        voicing.setRoutes($routes.value, filter);
      }),
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
        modelToSnap: ({ $legato, $portamento, $maxVoices }) => {
          return {
            leg: $legato.value,
            port: $portamento.value,
            max: $maxVoices.value,
          };
        },
        applySnap: (snap, { $legato, $portamento, $maxVoices }) => {
          snap.leg !== undefined && $legato.next(snap.leg);
          snap.port !== undefined && $portamento.next(snap.port);
          snap.max !== undefined && $maxVoices.next(snap.max);
        },
      })
    );

export const {
  ModelProvider: SynthProvider,
  useModel: useSynth,
  Context: SynthContext,
} = rxModelReact('synth', synth);

export type SynthModule = ReturnType<typeof useSynth>;
