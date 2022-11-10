import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { InputControllerModule } from './input-controller';
import { AdsrEnvelopeModule, AdsrEnvelopeModel } from './adsr-envelope';
import { OscillatorModule } from './oscillator';
import { SynthCoreModule } from './synth-core';
import { Note } from '@waveform/ui-kit';
import { noteFrequency } from '../../../common/constants';

// @todo refactor and decompose that file
interface Deps {
  inputController: InputControllerModule;
  adsrEnvelope: AdsrEnvelopeModule;
  oscillator: [OscillatorModule, OscillatorModule];
  synthCore: SynthCoreModule;
}

const getFq = ([octave, note]: Note) => noteFrequency[note] * 2 ** (octave - 1);
const noteToString = ([octave, note]: Note) => `${note}${octave}`;

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
}

const unisonOscillator = (audioCtx: AudioContext, config: OscillatorConfig) => {
  const oscillators: OscillatorNode[] = [];
  const from = -config.detune / 2;
  const step = config.detune / (config.unison - 1);
  const merger = audioCtx.createChannelMerger(2);

  for (let i = 0; i < config.unison; i++) {
    const oscillator = audioCtx.createOscillator();
    oscillator.setPeriodicWave(config.wave);

    if (config.unison !== 1) oscillator.detune.setValueAtTime(from + step * i, audioCtx.currentTime);
    oscillator.frequency.setValueAtTime(config.frequency, audioCtx.currentTime);
    oscillators.push(oscillator);
  }

  const start = (time?: number) =>
    oscillators.forEach((oscillator) =>
      oscillator.start((time ?? audioCtx.currentTime) + Math.random() * config.randPhase)
    );
  const setWave = (wave: PeriodicWave) =>
    oscillators.forEach((oscillator) => oscillator.setPeriodicWave(wave));
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

  return { start, connect, setWave, stop };
};

const voice = (
  audioCtx: AudioContext,
  outputNode: AudioNode,
  [octave, note]: Note,
  adsrConfig: AdsrEnvelopeModel['$envelope']['value'],
  oscConfigs: Array<Omit<OscillatorConfig, 'frequency'>>
) => {
  const voices = oscConfigs.map((oscConfig) => {
    const osc = unisonOscillator(audioCtx, {
      ...oscConfig,
      frequency: getFq([octave + oscConfig.octave, note]),
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
  const setWave = (index: number, wave: PeriodicWave) => voices[index]?.osc.setWave(wave);
  return { stop, setWave };
};

const synth = ({
  synthCore: [{ audioCtx, preGain }],
  inputController: [{ $onPress, $onRelease }],
  adsrEnvelope: [{ $envelope }],
  oscillator: oscillators,
}: Deps) =>
  rxModel(() => {
    const voices: Record<string, ReturnType<typeof voice> | null> = {};
    return { voices };
  }).subscriptions(({ voices }) => [
    $onRelease.subscribe((note) => {
      voices[noteToString(note)]?.stop();
      voices[noteToString(note)] = null;
    }),
    $onPress.subscribe((note) => {
      if (voices[noteToString(note)]) return;

      voices[noteToString(note)] = voice(
        audioCtx,
        preGain,
        note,
        $envelope.value,
        oscillators
          .filter(([oscillator]) => oscillator.$active.value)
          .map(([oscillator]) => ({
            ...oscillator.$osc.value,
            wave: oscillator.$periodicWave.value,
            gainNode: oscillator.gainNode,
          }))
      );
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
