import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { InputControllerModule } from './input-controller';
import { AdsrEnvelopeModule, AdsrEnvelopeModel } from './adsr-envelope';
import { OscillatorModel, OscillatorModule } from './oscillator';
import { SynthCoreModule } from './synth-core';
import { Note, Notes } from '@waveform/ui-kit';
import { noteFrequency } from '../../../common/constants';

// @todo refactor and decompose that file
interface Deps {
  synthCore: SynthCoreModule;
  inputController: InputControllerModule;
  adsrEnvelope: AdsrEnvelopeModule;
  oscillator: [OscillatorModule, OscillatorModule];
}

const getFq = ([octave, note]: Note) => noteFrequency[note] * 2 ** (octave - 1);
const noteToString = ([octave, note]: Note) => `${note}${octave}`;
const stringToNote = (value: string): Note => {
  const octave = value.slice(-1);
  const note = value.replace(octave, '');
  return [Number(octave), note as Notes];
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

interface OscillatorConfig {
  wave: PeriodicWave;
  frequency: number;
  unison: number;
  detune: number;
  randPhase: number;
  octave: number;
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

    if (config.unison !== 1) oscillator.detune.setValueAtTime(from + step * i, audioCtx.currentTime);
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
  oscConfigs: Array<Omit<OscillatorConfig, 'frequency'> & { gainNode: GainNode }>;
  portamento?: [Note, number];
}

type VoiceConfig = OscillatorVoiceConfig & {
  adsrConfig: AdsrEnvelopeModel['$envelope']['value'];
};

type VoiceOscillators = Array<ReturnType<typeof unisonOscillator>>;

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

    return oscConfigs.map((oscConfig) => {
      const initFq = getFq([octave + oscConfig.octave, noteName]);
      const fromFq = portamento ? getFq([portamento[0][0] + oscConfig.octave, portamento[0][1]]) : 0;
      const osc = unisonOscillator(audioCtx, {
        ...oscConfig,
        frequency: portamento ? fromFq : initFq,
        portamento: portamento ? [initFq, portamento[1]] : undefined,
      });

      osc.connect(this.config.outputNode);
      osc.start();
      return osc;
    });
  }

  stop(time: number) {
    this.oscillators.forEach((oscillator) => {
      oscillator.stop(time);
    });
  }

  immediatelyStop() {
    const { audioCtx } = this.config;
    this.oscillators.forEach((oscillator) => oscillator.stop(audioCtx.currentTime));
  }
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
  oscillators: Array<Pick<OscillatorModel, '$osc' | '$active' | '$periodicWave' | 'gainNode'>>;
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
          wave: oscillator.$periodicWave.value,
          gainNode: oscillator.gainNode,
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
}

const synth = ({
  synthCore: [{ audioCtx, preGain }],
  inputController: [{ $onPress, $onRelease }],
  adsrEnvelope: [{ $envelope }],
  oscillator: oscillators,
}: Deps) =>
  rxModel(() => {
    const $maxVoices = new PrimitiveBS<number>(2);
    const $portamento = new PrimitiveBS<number>(30);
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
        $osc: osc.$osc,
        $active: osc.$active,
        $periodicWave: osc.$periodicWave,
        gainNode: osc.gainNode,
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
      // ...oscillators.map(([{ $periodicWave }], i) =>
      //   $periodicWave.subscribe((wave) => {
      //     for (const voice in voices) {
      //       // @todo here is the bug - wave not update while playing for osc2, if osc1 is stoped
      //       voices[voice]?.setWave(i, wave);
      //     }
      //   })
      // ),
    ]);

export const { ModelProvider: SynthProvider, useModel: useSynth } = rxModelReact('synth', synth);
