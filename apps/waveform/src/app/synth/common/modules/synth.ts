import { BehaviorSubject, pairwise, skip, Subject } from 'rxjs';
import { Note } from '@waveform/ui-kit';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { ENVELOPES, MOD_SOURCES } from '@waveform/preset-schema';
import { getFq, stringToNote, noteToString } from '../../services';
import { urlSnapshotPlugin } from '../../../app';
import type { VoiceEndedMessage, VoiceOscOptions, VoiceStartedMessage } from '../wavetable/wavetable-osc-dsp';
import type { EnvelopeParams } from '../envelope/envelope-curve';
import type { VoiceRoute, VoiceRoutesMessage } from '../wavetable/voice-modulation';
import type { VoiceFilterMessage, VoiceFilterOptions } from '../wavetable/voice-filter';
import { amountInUnits, filterTargetScale, MOD_TARGETS } from '../modulation/modulation-targets';
import type { FilterModule } from '../../filter/modules/filter';
import type { FxNote } from '../../fx/effects/fx-modulation';
import { OSC_PARAMS, OscParam, oscParamName, VoiceParam } from '../wavetable/wavetable-osc-params';
import { InputControllerModule } from './input-controller';
import { EnvelopesModule } from './envelopes';
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

interface VoiceConfig {
  audioCtx: AudioContext;
  createNode: SynthCoreModule[0]['wavetables']['createVoice'];
  outputNode: AudioNode;
  note: Note;
  // the seconds of the context time of the note on (read once: out of legato envStart is the same)
  start: number;
  oscillators: VoiceOscillator[];
  // the note it glides from and the seconds of the glide
  portamento?: [Note, number];
  // ENV 1–3 of the note (read at the note on, in legato at the start of the phrase) and the seconds of the
  // context time they start at (in legato the start of the phrase: they don't start again)
  envelopes: EnvelopeParams[];
  envStart: number;
  // the routes of the modulation (to its params: voiceRoutes) and the filter (null: off)
  routes: ModRoute[];
  filter: VoiceFilterOptions | null;
  // the voice has ended: its node is off the graph
  onEnded: (voice: Voice) => void;
  // traces the voice: its processor posts the frames of its start
  onStarted?: (message: VoiceStartedMessage) => void;
}

// the node of a note: both oscillators (off: not active when it was pressed) with their unison voices and its
// envelopes (ENV 1 is its volume); the knobs are the base of its params (oscillator $params), the unison, the
// phases, on/off and the envelopes are read now
const createVoiceNode = ({
  audioCtx,
  createNode,
  note,
  start: now,
  oscillators,
  portamento,
  envelopes,
  envStart,
  routes,
  filter,
  onStarted,
}: VoiceConfig) => {
  const frequency = getFq(note);
  const from = portamento ? getFq(portamento[0]) : frequency;
  const parameterData: Partial<Record<VoiceParam, number>> = { frequency: from };
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
      routes: voiceRoutes(routes, on, filter),
      filter,
      ...(onStarted && { trace: true }),
    },
    parameterData
  );
  if (node && portamento) {
    const param = node.parameters.get('frequency') as AudioParam;
    param.setValueAtTime(from, now);
    param.linearRampToValueAtTime(frequency, now + portamento[1]);
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
  // the end of the release, Infinity while the note is held
  releaseEnd = Infinity;
  // its envelopes, as the fx follow them while it is the last note (from the frame it is scheduled at: a voice
  // processed later starts its own there, at most a device buffer after them)
  readonly fxNote: FxNote;
  // the routes its processor has (JSON): a change of the routes of other knobs sends nothing
  private routes: string;

  // node: from createVoiceNode, the voicing creates a voice only for a node. Global sources (an LFO) come
  // through the mod buses of the oscillators
  constructor(config: VoiceConfig, node: AudioWorkletNode) {
    this.config = config;
    this.node = node;
    this.fxNote = { envelopes: config.envelopes, start: config.envStart, release: null };
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

  // the key is released: the release of ENV 1 starts now, from the level it has reached
  stop = () => {
    const now = this.config.audioCtx.currentTime;
    setParam(this.gate, 0, now);
    this.releaseEnd = now + this.config.envelopes[0].release;
  };

  // a stolen voice: its node fades out (5 ms) instead of being cut
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
  private phrase: { start: number; envelopes: EnvelopeParams[] } | undefined;
  // the last note pressed: the fx follow its envelopes until the next one
  private last: Voice | null = null;

  constructor(config: VoicingContext) {
    this.voices = {};
    this.config = config;
  }

  // the voice of a note, null if the oscillator isn't ready (a note played meanwhile is not played later)
  private getVoice = (note: Note): Voice | null => {
    const { audioCtx, outputNode, createNode, $legato, $portamento, $envelopes, $routes, oscillators } =
      this.config;
    const { voiceFilter, $voiceStarts } = this.config;
    const voicesArray = Object.keys(this.voices);
    const key = voicesArray[voicesArray.length - 1];
    const now = audioCtx.currentTime;
    const envelopes = ENVELOPES.map((id) => $envelopes.value[id]);
    if ($legato.value && !this.phrase) this.phrase = { start: now, envelopes };
    const phrase = $legato.value ? this.phrase : undefined;

    const voiceConfig: VoiceConfig = {
      audioCtx,
      createNode,
      outputNode,
      note,
      start: now,
      oscillators,
      portamento: key && !$legato.value ? [stringToNote(key), $portamento.value / 1000] : undefined,
      envelopes: phrase?.envelopes ?? envelopes,
      envStart: phrase?.start ?? now,
      routes: $routes.value,
      filter: voiceFilter(),
      onStarted:
        __PERF__ && $voiceStarts.observed
          ? ({ scheduled, started }) => $voiceStarts.next({ note: noteToString(note), scheduled, started })
          : undefined,
      onEnded: (voice) => {
        this.sounding.delete(voice);
        if (this.forget(voice)) this.config.onCount();
      },
    };
    const node = createVoiceNode(voiceConfig);
    return node ? new Voice(voiceConfig, node) : null;
  };

  // a released voice is no longer counted: it has ended or it is stolen; true if it was
  private forget(voice: Voice) {
    const index = this.released.indexOf(voice);
    if (index >= 0) this.released.splice(index, 1);
    return index >= 0;
  }

  // a voice above Poly is stolen (it fades out): the oldest released one, else the oldest held one
  private steal() {
    const released = this.released.shift();
    if (released) {
      released.immediatelyStop();
      return;
    }
    const [key] = Object.keys(this.voices);
    this.voices[key]?.immediatelyStop();
    delete this.voices[key];
  }

  // a note played before the oscillator is ready is not played (nor later)
  onPress = (note: Note) => {
    if (!this.config.isReady()) return;
    // the released voices whose release is over are not counted (their ended message is on its way)
    const now = this.config.audioCtx.currentTime;
    this.released = this.released.filter((voice) => voice.releaseEnd > now);
    if (this.voicesCount >= this.config.$maxVoices.value) this.steal();
    const voice = this.getVoice(note);
    if (!voice) return;
    this.voices[noteToString(note)] = voice;
    this.sounding.add(voice);
    this.last = voice;
    this.config.$fxNote.next(voice.fxNote);
  };

  onRelease = (note: Note) => {
    const stringNote = noteToString(note);
    const voice = this.voices[stringNote];
    // the voice of a stolen note has already stopped, the held ones keep playing
    if (!voice) return;
    voice.stop();
    delete this.voices[stringNote];
    this.released.push(voice);
    const held = Object.keys(this.voices).length;
    // the fx release their envelopes with the last note, in legato with the last key of the phrase
    const { $fxNote } = this.config;
    if ($fxNote.value && (this.phrase ? held === 0 : voice === this.last))
      $fxNote.next({ ...$fxNote.value, release: this.config.audioCtx.currentTime });
    // the last key of a legato phrase: the next note starts a new one
    if (held === 0) this.phrase = undefined;
  };

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
    .subscriptions(({ voicing }, { setVoicesCount }) => [
      $onRelease.subscribe((note) => {
        voicing.onRelease(note);

        setVoicesCount(voicing.voicesCount);
      }),
      $onPress.subscribe((note) => {
        voicing.onPress(note);
        setVoicesCount(voicing.voicesCount);
      }),
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
