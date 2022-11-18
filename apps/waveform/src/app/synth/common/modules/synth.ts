import { Note } from '@waveform/ui-kit';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { getFq, stringToNote, noteToString } from '../../services';
import { InputControllerModule } from './input-controller';
import { AdsrEnvelopeModule, AdsrEnvelopeModel } from './adsr-envelope';
import { OscillatorModel, OscillatorModule } from './oscillator';
import { SynthCoreModule } from './synth-core';

// @todo refactor and decompose that file
interface Deps {
  synthCore: SynthCoreModule;
  inputController: InputControllerModule;
  adsrEnvelope: AdsrEnvelopeModule;
  oscillator: [OscillatorModule, OscillatorModule];
}

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

interface OscillatorConfig {
  id: string;
  wave: PeriodicWave;
  frequency: number;
  unison: number;
  detune: number;
  randPhase: number;
  octave: number;
  gain: number;
  portamento?: [number, number]; // [freq, time]
  onEnd?: () => void;
}

const unisonOscillator = (audioCtx: AudioContext, config: OscillatorConfig) => {
  const oscillators: OscillatorNode[] = [];
  const from = -config.detune / 2;
  const step = config.detune / (config.unison - 1);
  const merger = audioCtx.createChannelMerger(2);

  const setFqPortamento =
    (fromFq: number, [fq, time]: [number, number]) =>
    (oscillator: OscillatorNode) => {
      oscillator.frequency.setValueAtTime(fromFq, audioCtx.currentTime);
      oscillator.frequency.linearRampToValueAtTime(fq, audioCtx.currentTime + time);
    };

  const setFq = (frequency: number) => (oscillator: OscillatorNode) => {
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  };

  for (let i = 0; i < config.unison; i++) {
    const oscillator = audioCtx.createOscillator();
    oscillator.setPeriodicWave(config.wave);

    if (config.unison !== 1 && config.detune !== 0)
      oscillator.detune.setValueAtTime(from + step * i, audioCtx.currentTime);
    if (config.portamento) setFqPortamento(config.frequency, config.portamento)(oscillator);
    else setFq(config.frequency)(oscillator);

    oscillators.push(oscillator);
  }

  const start = (time?: number) =>
    oscillators.forEach((oscillator) =>
      oscillator.start((time ?? audioCtx.currentTime) + Math.random() * config.randPhase)
    );

  const setWave = (wave: PeriodicWave) =>
    oscillators.forEach((oscillator) => oscillator.setPeriodicWave(wave));

  const setFrequency = (frequency: number) => oscillators.forEach(setFq(frequency));

  const setFrequencyPortamento = (fromFq: number, portamento: [number, number]) =>
    oscillators.forEach(setFqPortamento(fromFq, portamento));

  const connect = (node: AudioNode) => {
    merger.connect(node);
    for (let i = 0; i < oscillators.length; i += 2) {
      const oscillator1 = oscillators[i];
      const oscillator2 = oscillators[i + 1];
      if (oscillator1 && oscillator2) {
        oscillator1.connect(merger, 0, 0);
        oscillator2.connect(merger, 0, 1);
      } else if (oscillator1) {
        oscillator1.connect(node);
      }
    }
  };

  const stop = (time?: number) =>
    oscillators.forEach((oscillator) => {
      oscillator.stop(time);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        merger.disconnect();
      });
    });

  return { start, connect, setWave, setFrequency, setFrequencyPortamento, stop };
};

interface OscillatorVoiceConfig {
  audioCtx: AudioContext;
  outputNode: AudioNode;
  note: Note;
  oscConfigs: Array<Omit<OscillatorConfig, 'frequency'>>;
  portamento?: [Note, number];
}

type VoiceConfig = OscillatorVoiceConfig & {
  adsrConfig: AdsrEnvelopeModel['$envelope']['value'];
};

type VoiceOscillators = Record<string, { osc: ReturnType<typeof unisonOscillator>; gain: GainNode }>;

abstract class OscillatorVoice {
  protected config: OscillatorVoiceConfig;
  protected oscillators: VoiceOscillators;

  constructor(config: OscillatorVoiceConfig) {
    this.config = config;
    this.oscillators = this.initOscillators();
  }

  protected initOscillators(): VoiceOscillators {
    const {
      audioCtx,
      note: [octave, noteName],
      portamento,
      oscConfigs,
    } = this.config;
    const oscillators: VoiceOscillators = {};

    for (const oscConfig of oscConfigs) {
      const initFq = getFq([octave + oscConfig.octave, noteName]);
      const fromFq = portamento ? getFq([portamento[0][0] + oscConfig.octave, portamento[0][1]]) : 0;
      const osc = unisonOscillator(audioCtx, {
        ...oscConfig,
        frequency: portamento ? fromFq : initFq,
        portamento: portamento ? [initFq, portamento[1]] : undefined,
      });

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(oscConfig.gain, audioCtx.currentTime);
      gain.connect(this.config.outputNode);
      osc.connect(gain);

      osc.start();

      oscillators[oscConfig.id] = { osc, gain };
    }
    return oscillators;
  }

  stop(time: number) {
    Object.values(this.oscillators).forEach(({ osc }) => osc.stop(time));
  }

  immediatelyStop() {
    const { audioCtx } = this.config;
    Object.values(this.oscillators).forEach(({ osc }) => osc.stop(audioCtx.currentTime));
  }

  setGainValue = (id: string, value: number) => {
    this.oscillators[id]?.gain.gain.setValueAtTime(value, this.config.audioCtx.currentTime);
  };

  setWave = (id: string, value: PeriodicWave) => {
    this.oscillators[id].osc.setWave(value);
  };
}

class Voice extends OscillatorVoice {
  override config: VoiceConfig;
  private adsr: ReturnType<typeof envelope>;

  constructor(config: VoiceConfig) {
    const { adsrConfig, outputNode, ...rest } = config;
    const adsr = envelope(rest.audioCtx, adsrConfig);
    super({ ...rest, outputNode: adsr.envelope });
    this.config = config;
    this.adsr = adsr;
    this.adsr.envelope.connect(outputNode);
  }

  override stop = () => {
    const { audioCtx, adsrConfig } = this.config;
    super.stop(audioCtx.currentTime + adsrConfig.release);
    this.adsr.stop();
  };

  override immediatelyStop = () => {
    super.immediatelyStop();
    this.adsr.stop();
  };
}

type LegatoVoiceConfig = VoiceConfig & {
  adsr: ReturnType<typeof envelope>;
};

class LegatoVoice extends OscillatorVoice {
  override config: LegatoVoiceConfig;
  private gain: GainNode;

  constructor(config: LegatoVoiceConfig) {
    const { adsr, outputNode, ...rest } = config;
    const gain = rest.audioCtx.createGain();
    super({ ...rest, outputNode: gain });
    this.config = config;
    this.gain = gain;
    gain.connect(adsr.envelope);
  }

  override stop = () => {
    const { audioCtx, adsrConfig } = this.config;
    super.stop(audioCtx.currentTime + adsrConfig.release);

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

  $maxVoices: PrimitiveBS<number>;
  $legato: PrimitiveBS<boolean>;
  $portamento: PrimitiveBS<number>;
  oscillators: Array<Pick<OscillatorModel, 'id' | '$osc' | '$active' | '$periodicWave' | '$gain'>>;
  $envelope: AdsrEnvelopeModel['$envelope'];
}

class Voicing {
  private config: VoicingContext;
  private voices: Record<string, Voice | LegatoVoice | null>;
  private legatoAdsr: ReturnType<typeof envelope> | undefined;

  constructor(config: VoicingContext) {
    this.voices = {};
    this.config = config;
  }

  private addVoice = (note: Note) => {
    this.voices[noteToString(note)] = this.getVoice(note);
  };

  private getVoice = (note: Note): Voice | LegatoVoice => {
    const { audioCtx, outputNode, $legato, $portamento, $envelope, oscillators } = this.config;
    const voicesArray = Object.keys(this.voices);
    const key = voicesArray[voicesArray.length - 1];

    const voiceConfig: VoiceConfig = {
      audioCtx,
      outputNode,
      note,
      portamento: key && !$legato.value ? [stringToNote(key), $portamento.value / 1000] : undefined,
      adsrConfig: $envelope.value,
      oscConfigs: oscillators
        .filter(({ $active }) => $active.value)
        .map((oscillator) => ({
          ...oscillator.$osc.value,
          id: oscillator.id,
          wave: oscillator.$periodicWave.value,
          gain: oscillator.$gain.value,
        })),
    };

    if (!$legato.value) return new Voice(voiceConfig);
    if (!this.legatoAdsr) {
      this.legatoAdsr = envelope(audioCtx, $envelope.value);
      this.legatoAdsr.envelope.connect(outputNode);
    }

    return new LegatoVoice({ ...voiceConfig, adsr: this.legatoAdsr });
  };

  private stopLastVoice() {
    const voicesArray = Object.keys(this.voices);
    const key = voicesArray[0];
    this.voices[key]?.immediatelyStop();
    delete this.voices[key];
  }

  onPress = (note: Note) => {
    if (this.voicesCount >= this.config.$maxVoices.value) this.stopLastVoice();
    this.addVoice(note);
  };

  onRelease = (note: Note) => {
    const stringNote = noteToString(note);
    this.voices[stringNote]?.stop();

    if (this.legatoAdsr && this.voicesCount === 1) {
      this.legatoAdsr.stop();
      this.legatoAdsr = undefined;
    }

    delete this.voices[stringNote];
  };

  get voicesCount() {
    return Object.keys(this.voices).length;
  }

  setGain = (oscId: string) => (value: number) => {
    Object.values(this.voices).forEach((voice) => voice?.setGainValue(oscId, value));
  };

  setWave = (oscId: string) => (wave: PeriodicWave) => {
    Object.values(this.voices).forEach((voice) => voice?.setWave(oscId, wave));
  };
}

const synth = ({
  synthCore: [{ audioCtx, preGain }],
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
      $maxVoices,
      $legato,
      $portamento,
      $envelope,
      oscillators: oscillators.map(([osc]) => ({
        id: osc.id,
        $osc: osc.$osc,
        $active: osc.$active,
        $periodicWave: osc.$periodicWave,
        $gain: osc.$gain,
      })),
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
    .subscriptions(({ $maxVoices, $portamento, $legato, voicing }, { setVoicesCount }) => [
      $onRelease.subscribe((note) => {
        voicing.onRelease(note);

        setVoicesCount(voicing.voicesCount);
      }),
      $onPress.subscribe((note) => {
        voicing.onPress(note);
        setVoicesCount(voicing.voicesCount);
      }),
      ...oscillators
        .map(([{ id, $gain, $periodicWave }]) => [
          $gain.subscribe(voicing.setGain(id)),
          $periodicWave.subscribe(voicing.setWave(id)),
        ])
        .flat(),
    ]);

export const { ModelProvider: SynthProvider, useModel: useSynth } = rxModelReact('synth', synth);
