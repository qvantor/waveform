import { filter } from 'rxjs';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { InputControllerModule } from './input-controller';
import { AdsrEnvelopeModule, AdsrEnvelopeModel } from './adsr-envelope';
import { OscillatorModule } from './oscillator';
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
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.001, now + config.release);
  };

  return { stop, envelope: gain };
};

interface OscillatorConfig {
  wave: PeriodicWave;
  gainNode: GainNode;
  frequency: number;
  unison: number;
  detune: number;
  randPhase: number;
  octave: number;
  portamento?: [number, number]; // [freq, time]
}

const unisonOscillator = (audioCtx: AudioContext, config: OscillatorConfig) => {
  const oscillators: OscillatorNode[] = [];
  const from = -config.detune / 2;
  const step = config.detune / (config.unison - 1);
  const merger = audioCtx.createChannelMerger(2);

  const setFqPortamento = (fq: number, porta: number, fromFq?: number) => (oscillator: OscillatorNode) => {
    oscillator.frequency.setValueAtTime(fromFq ?? oscillator.frequency.value, audioCtx.currentTime);
    oscillator.frequency.linearRampToValueAtTime(fq, audioCtx.currentTime + porta);
  };

  const setFq = (frequency: number) => (oscillator: OscillatorNode) => {
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  };

  for (let i = 0; i < config.unison; i++) {
    const oscillator = audioCtx.createOscillator();
    oscillator.setPeriodicWave(config.wave);

    if (config.unison !== 1) oscillator.detune.setValueAtTime(from + step * i, audioCtx.currentTime);
    if (config.portamento)
      setFqPortamento(config.frequency, config.portamento[1], config.portamento[0])(oscillator);
    else setFq(config.frequency)(oscillator);

    oscillators.push(oscillator);
  }

  const start = (time?: number) =>
    oscillators.forEach((oscillator) =>
      oscillator.start((time ?? audioCtx.currentTime) + Math.random() * config.randPhase)
    );

  const setWave = (wave: PeriodicWave) =>
    oscillators.forEach((oscillator) => oscillator.setPeriodicWave(wave));
  const setFrequency = (frequency: number, porta?: number) => {
    oscillators.forEach(porta ? setFqPortamento(frequency, porta) : setFq(frequency));
  };

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

  return { start, connect, setWave, setFrequency, stop };
};

interface VoiceConfig {
  audioCtx: AudioContext;
  outputNode: AudioNode;
  note: Note;
  portamento?: [Note, number]; // noteFrom, time
}

const voice = (
  { audioCtx, outputNode, note: [octave, note], portamento }: VoiceConfig,
  adsrConfig: AdsrEnvelopeModel['$envelope']['value'],
  oscConfigs: Array<Omit<OscillatorConfig, 'frequency'>>
) => {
  const voices = oscConfigs.map((oscConfig) => {
    const osc = unisonOscillator(audioCtx, {
      ...oscConfig,
      frequency: getFq([octave + oscConfig.octave, note]),
      portamento: portamento
        ? [getFq([portamento[0][0] + oscConfig.octave, portamento[0][1]]), portamento[1]]
        : undefined,
    });
    const adsr = envelope(audioCtx, adsrConfig);
    osc.connect(adsr.envelope);
    adsr.envelope.connect(oscConfig.gainNode);
    oscConfig.gainNode.connect(outputNode);
    osc.start();
    return { osc, adsr };
  });
  const stop = () => {
    voices.forEach((voice) => {
      voice.osc.stop(audioCtx.currentTime + adsrConfig.release);
      voice.adsr.stop();
    });
  };

  const setNote = ([octave, note]: Note, porta?: number) => {
    voices.forEach((voice, i) => {
      voice.osc.setFrequency(getFq([octave + oscConfigs[i].octave, note]), porta);
    });
  };
  const setWave = (index: number, wave: PeriodicWave) => voices[index]?.osc.setWave(wave);
  return { stop, setWave, setNote };
};

const synth = ({
  synthCore: [{ audioCtx, preGain }],
  inputController: [{ $onPress, $onRelease }],
  adsrEnvelope: [{ $envelope }],
  oscillator: oscillators,
}: Deps) =>
  rxModel(() => {
    const $maxVoices = new PrimitiveBS<number>(6);
    const $portamento = new PrimitiveBS<number>(30);
    const $legato = new PrimitiveBS<boolean>(true);
    const $voicesCount = new PrimitiveBS<number>(0);
    const voices: Record<string, ReturnType<typeof voice> | null> = {};
    return { $maxVoices, $portamento, $legato, $voicesCount, voices };
  })
    .actions(({ $maxVoices, $portamento, $legato, $voicesCount }) => ({
      setMaxVoices: (value: number) => $maxVoices.next(value),
      setPortamento: (value: number) => $portamento.next(value),
      setLegato: (value: boolean) => $legato.next(value),
      setVoicesCount: (value: number) => $voicesCount.next(value),
    }))
    .subscriptions(({ voices, $maxVoices, $portamento, $legato }, { setVoicesCount }) => [
      $onRelease.subscribe((note) => {
        voices[noteToString(note)]?.stop();
        delete voices[noteToString(note)];

        setVoicesCount(Object.keys(voices).length)
      }),
      $onPress.pipe(filter(() => Object.keys(voices).length >= $maxVoices.value)).subscribe((note) => {
        const voicesArray = Object.keys(voices);
        const key = voicesArray[0];
        const existingVoice = voices[key];
        existingVoice?.setNote(note, $legato.value ? undefined : $portamento.value / 1000);
        voices[noteToString(note)] = existingVoice;
        delete voices[key];
      }),
      $onPress.pipe(filter(() => Object.keys(voices).length < $maxVoices.value)).subscribe((note) => {
        const voicesArray = Object.keys(voices);
        const key = voicesArray[voicesArray.length - 1];

        voices[noteToString(note)] = voice(
          {
            audioCtx,
            outputNode: preGain,
            note,
            portamento: key && !$legato.value ? [stringToNote(key), $portamento.value / 1000] : undefined,
          },
          $envelope.value,
          oscillators
            .filter(([oscillator]) => oscillator.$active.value)
            .map(([oscillator]) => ({
              ...oscillator.$osc.value,
              wave: oscillator.$periodicWave.value,
              gainNode: oscillator.gainNode,
            }))
        );

        setVoicesCount(Object.keys(voices).length)
      }),
      ...oscillators.map(([{ $periodicWave }], i) =>
        $periodicWave.subscribe((wave) => {
          for (const voice in voices) {
            // @todo here is the bug - wave not update while playing for osc2, if osc1 is stoped
            voices[voice]?.setWave(i, wave);
          }
        })
      ),
    ]);

export const { ModelProvider: SynthProvider, useModel: useSynth } = rxModelReact('synth', synth);
