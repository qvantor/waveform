import { pairwise } from 'rxjs';
import { Note } from '@waveform/ui-kit';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { getFq, stringToNote, noteToString } from '../../services';
import { urlSnapshotPlugin } from '../../../app';
import type { VoiceEndedMessage, VoiceOscOptions } from '../wavetable/wavetable-osc-dsp';
import { OSC_PARAMS, OscParam, oscParamName, VoiceParam } from '../wavetable/wavetable-osc-params';
import { InputControllerModule } from './input-controller';
import { AdsrEnvelopeModule, AdsrEnvelopeModel } from './adsr-envelope';
import { OscillatorModel, OscillatorModule } from './oscillator';
import { SynthCoreModule } from './synth-core';

interface Deps {
  synthCore: SynthCoreModule;
  inputController: InputControllerModule;
  adsrEnvelope: AdsrEnvelopeModule;
  oscillator: [OscillatorModule, OscillatorModule];
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

const envelope = (audioCtx: AudioContext, config: AdsrEnvelopeModel['$envelope']['value']) => {
  const gain = audioCtx.createGain();

  const now = audioCtx.currentTime;

  // Attack
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + config.attack);
  gain.gain.setValueAtTime(1, now + config.attack);
  // Hold
  gain.gain.linearRampToValueAtTime(1, now + config.attack + config.hold);
  // Decay and sustain
  gain.gain.linearRampToValueAtTime(config.sustain, now + config.attack + config.hold + config.decay);

  const stop = () => {
    const now = audioCtx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now); // more valid - Math.min(gain.gain.value, config.sustain) (but it's clicks)
    gain.gain.linearRampToValueAtTime(0.001, now + config.release);
  };

  return { stop, envelope: gain };
};

// the envelope the voices of a legato phrase share: taken off the output once it is released and the last voice
// playing into it has ended
const legatoEnvelope = (
  audioCtx: AudioContext,
  config: AdsrEnvelopeModel['$envelope']['value'],
  outputNode: AudioNode
) => {
  const adsr = envelope(audioCtx, config);
  adsr.envelope.connect(outputNode);
  let voices = 0;
  let released = false;
  const disconnect = () => {
    if (released && voices === 0) adsr.envelope.disconnect();
  };

  return {
    envelope: adsr.envelope,
    // a voice plays into it until the returned function is called
    attach: () => {
      voices++;
      return () => {
        voices--;
        disconnect();
      };
    },
    stop: () => {
      adsr.stop();
      released = true;
      disconnect();
    },
  };
};

type VoiceOscillator = Pick<OscillatorModel, 'id' | '$active' | '$osc' | '$params' | 'buses' | '$busSources'>;

interface OscillatorVoiceConfig {
  audioCtx: AudioContext;
  createNode: SynthCoreModule[0]['wavetables']['createVoice'];
  note: Note;
  oscillators: VoiceOscillator[];
  // the note it glides from and the seconds of the glide
  portamento?: [Note, number];
  // the voice has ended: its nodes are off the graph
  onEnded: (voice: OscillatorVoice) => void;
}

type VoiceConfig = OscillatorVoiceConfig & {
  outputNode: AudioNode;
  adsrConfig: AdsrEnvelopeModel['$envelope']['value'];
};

// the node of a note: both oscillators (off: not active when it was pressed) with their unison voices; the
// knobs are the base of its params (oscillator $params), the unison, the phases and on/off are read now
const createVoiceNode = ({ audioCtx, createNode, note, oscillators, portamento }: OscillatorVoiceConfig) => {
  const now = audioCtx.currentTime;
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
  const node = createNode({ osc, start: now }, parameterData);
  if (node && portamento) {
    const param = node.parameters.get('frequency') as AudioParam;
    param.setValueAtTime(from, now);
    param.linearRampToValueAtTime(frequency, now + portamento[1]);
  }
  return node;
};

abstract class OscillatorVoice {
  protected config: OscillatorVoiceConfig;
  protected node: AudioWorkletNode;

  // node: from createVoiceNode, the voicing creates a voice only for a node. The sources of a voice (its
  // envelopes) would connect to node.parameters directly, the global ones come through the buses
  constructor(config: OscillatorVoiceConfig, node: AudioWorkletNode, output: AudioNode) {
    this.config = config;
    this.node = node;
    this.on = config.oscillators.map(({ $active }) => $active.value);
    node.connect(output);
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
      this.onEnded();
      config.onEnded(this);
    };
    node.port.onmessage = ({ data }: MessageEvent<VoiceEndedMessage>) => {
      if (data.ended) end();
    };
    // its processor failed outside process() (an error in process() ends the voice there): it never ends
    node.onprocessorerror = (event) => {
      console.error('A voice of the wavetable oscillator failed', event);
      end();
    };
  }

  // the mod buses connected to the params of the node (of the oscillators on for the note), by osc and param
  private links = new Map<string, () => void>();

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

  // the oscillators on when the note was pressed
  private on: boolean[];

  // takes the nodes of the voice off once its node has ended
  protected abstract onEnded(): void;

  private get gate() {
    return this.node.parameters.get('gate') as AudioParam;
  }

  // the end of the note: its gate closes at `time`, the end of the release
  protected closeGate(time: number) {
    setParam(this.gate, 1, this.config.audioCtx.currentTime);
    this.gate.setValueAtTime(0, time);
  }

  // a stolen voice: its node fades out (5 ms) instead of being cut
  immediatelyStop() {
    setParam(this.gate, -1, this.config.audioCtx.currentTime);
  }

  // the knob of a param of an oscillator: the octave at once, the others glide
  setParam = (osc: number, param: OscParam, value: number) => {
    const audioParam = this.node.parameters.get(oscParamName(param, osc)) as AudioParam;
    (param === 'detune' ? setParam : glideParam)(audioParam, value, this.config.audioCtx.currentTime);
  };
}

class Voice extends OscillatorVoice {
  override config: VoiceConfig;
  private adsr: ReturnType<typeof envelope>;

  constructor(config: VoiceConfig, node: AudioWorkletNode) {
    const adsr = envelope(config.audioCtx, config.adsrConfig);
    super(config, node, adsr.envelope);
    this.config = config;
    this.adsr = adsr;
    this.adsr.envelope.connect(config.outputNode);
  }

  stop = () => {
    const { audioCtx, adsrConfig } = this.config;
    this.closeGate(audioCtx.currentTime + adsrConfig.release);
    this.adsr.stop();
  };

  override immediatelyStop = () => {
    super.immediatelyStop();
    this.adsr.stop();
  };

  protected onEnded() {
    this.adsr.envelope.disconnect();
  }
}

type LegatoVoiceConfig = VoiceConfig & {
  adsr: ReturnType<typeof legatoEnvelope>;
};

class LegatoVoice extends OscillatorVoice {
  override config: LegatoVoiceConfig;
  private gain: GainNode;
  private detach: () => void;

  constructor(config: LegatoVoiceConfig, node: AudioWorkletNode) {
    const gain = config.audioCtx.createGain();
    super(config, node, gain);
    this.config = config;
    this.gain = gain;
    gain.connect(config.adsr.envelope);
    this.detach = config.adsr.attach();
  }

  protected onEnded() {
    this.gain.disconnect();
    this.detach();
  }

  stop = () => {
    const { audioCtx, adsrConfig } = this.config;
    this.closeGate(audioCtx.currentTime + adsrConfig.release);

    // @todo it should be partial envelope with release only
    const now = audioCtx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0.001, now + this.config.adsrConfig.release);
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
  $envelope: AdsrEnvelopeModel['$envelope'];
}

class Voicing {
  private config: VoicingContext;
  // the voices of the held notes
  private voices: Record<string, Voice | LegatoVoice | null>;
  // every voice until it has ended, the released ones too: they follow the knobs, and their nodes stay
  // referenced (WebKit collects an AudioWorkletNode JS no longer holds, even while it plays)
  private sounding = new Set<OscillatorVoice>();
  private legatoAdsr: ReturnType<typeof legatoEnvelope> | undefined;

  constructor(config: VoicingContext) {
    this.voices = {};
    this.config = config;
  }

  // the voice of a note, null if the oscillator isn't ready (a note played meanwhile is not played later)
  private getVoice = (note: Note): Voice | LegatoVoice | null => {
    const { audioCtx, outputNode, createNode, $legato, $portamento, $envelope, oscillators } = this.config;
    const voicesArray = Object.keys(this.voices);
    const key = voicesArray[voicesArray.length - 1];

    const voiceConfig: VoiceConfig = {
      audioCtx,
      createNode,
      outputNode,
      note,
      oscillators,
      portamento: key && !$legato.value ? [stringToNote(key), $portamento.value / 1000] : undefined,
      adsrConfig: $envelope.value,
      onEnded: (voice) => this.sounding.delete(voice),
    };
    const node = createVoiceNode(voiceConfig);
    if (!node) return null;

    if (!$legato.value) return new Voice(voiceConfig, node);
    if (!this.legatoAdsr) this.legatoAdsr = legatoEnvelope(audioCtx, $envelope.value, outputNode);

    return new LegatoVoice({ ...voiceConfig, adsr: this.legatoAdsr }, node);
  };

  private stopLastVoice() {
    const voicesArray = Object.keys(this.voices);
    const key = voicesArray[0];
    this.voices[key]?.immediatelyStop();
    delete this.voices[key];
  }

  // a note played before the oscillator is ready is not played (nor later)
  onPress = (note: Note) => {
    if (!this.config.isReady()) return;
    if (this.voicesCount >= this.config.$maxVoices.value) this.stopLastVoice();
    const voice = this.getVoice(note);
    if (!voice) return;
    this.voices[noteToString(note)] = voice;
    this.sounding.add(voice);
  };

  onRelease = (note: Note) => {
    const stringNote = noteToString(note);
    const voice = this.voices[stringNote];
    // the voice of a stolen note has already stopped, the held ones keep playing
    if (!voice) return;
    voice.stop();
    delete this.voices[stringNote];

    if (this.legatoAdsr && this.voicesCount === 0) {
      this.legatoAdsr.stop();
      this.legatoAdsr = undefined;
    }
  };

  get voicesCount() {
    return Object.keys(this.voices).length;
  }

  setParam = (osc: number, param: OscParam, value: number) =>
    this.sounding.forEach((voice) => voice.setParam(osc, param, value));

  setBus = (osc: number, param: OscParam, used: boolean) =>
    this.sounding.forEach((voice) => voice.setBus(osc, param, used));
}

export const synth = ({
  synthCore: [{ audioCtx, preGain, wavetables }],
  inputController: [{ $onPress, $onRelease }],
  adsrEnvelope: [{ $envelope }],
  oscillator: oscillators,
}: Deps) =>
  rxModel(() => {
    const $maxVoices = new PrimitiveBS<number>(8);
    const $portamento = new PrimitiveBS<number>(0);
    const $legato = new PrimitiveBS<boolean>(false);
    const $voicesCount = new PrimitiveBS<number>(0);

    // move to another module
    const voicingContext: VoicingContext = {
      audioCtx,
      outputNode: preGain,
      createNode: wavetables.createVoice,
      isReady: () => wavetables.$status.value === 'ready',
      $maxVoices,
      $legato,
      $portamento,
      $envelope,
      oscillators: oscillators.map(([osc]) => osc),
    };
    const voicing = new Voicing(voicingContext);

    return { $maxVoices, $portamento, $legato, $voicesCount, voicing };
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

export const { ModelProvider: SynthProvider, useModel: useSynth } = rxModelReact('synth', synth);
