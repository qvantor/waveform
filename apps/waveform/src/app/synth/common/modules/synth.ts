import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { InputControllerModule } from './input-controller';
import { AdsrEnvelopeModule, AdsrEnvelopeModel } from './adsr-envelope';
import { OscillatorModule } from './oscillator';
import { Note } from '@waveform/ui-kit';
import { noteFrequency } from '../../../common/constants';

interface Deps {
  inputController: InputControllerModule;
  adsrEnvelope: AdsrEnvelopeModule;
  oscillator: OscillatorModule;
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
  frequency: number;
  unison: number;
  detune: number;
  randPhase: number;
}

const unisonOscillator = (audioCtx: AudioContext, config: OscillatorConfig) => {
  const oscillators: OscillatorNode[] = [];
  const from = -config.detune / 2;
  const step = config.detune / (config.unison - 1);

  for (let i = 0; i < config.unison; i++) {
    const oscillator = audioCtx.createOscillator();
    oscillator.type = 'sawtooth';

    if (config.unison !== 1) oscillator.detune.setValueAtTime(from + step * i, audioCtx.currentTime);
    oscillator.frequency.setValueAtTime(config.frequency, audioCtx.currentTime);
    oscillators.push(oscillator);
  }

  const start = (time?: number) =>
    oscillators.forEach(
      (oscillator) => oscillator.start((time ?? audioCtx.currentTime) + Math.random() * config.randPhase) // starts with random phase
    );
  const connect = (node: AudioNode) => oscillators.forEach((oscillator) => oscillator.connect(node));
  const stop = (time?: number) => oscillators.forEach((oscillator) => oscillator.stop(time));

  return { start, connect, stop };
};

const voice = (
  audioCtx: AudioContext,
  outputNode: AudioNode,
  note: Note,
  adsrConfig: AdsrEnvelopeModel['$envelope']['value'],
  oscConfig: Omit<OscillatorConfig, 'frequency'>
) => {
  const uOsc = unisonOscillator(audioCtx, {
    ...oscConfig,
    frequency: getFq(note),
  });
  const adsr = envelope(audioCtx, adsrConfig);
  uOsc.connect(adsr.envelope);
  adsr.envelope.connect(outputNode);

  uOsc.start();
  const stop = () => {
    adsr.stop();
    uOsc.stop(audioCtx.currentTime + adsrConfig.release);
  };
  return { stop };
};

const synth = ({
  inputController: [{ $onPress, $onRelease }],
  adsrEnvelope: [{ $envelope }],
  oscillator: [{ $osc }],
}: Deps) =>
  rxModel(() => {
    const audioCtx = new window.AudioContext();
    const preGain = audioCtx.createGain();
    const masterLimiter = audioCtx.createDynamicsCompressor();
    const masterGain = audioCtx.createGain();
    preGain.gain.setValueAtTime(0.07, audioCtx.currentTime);
    masterGain.gain.setValueAtTime(0.8, audioCtx.currentTime);

    masterLimiter.threshold.setValueAtTime(-12.0, audioCtx.currentTime);
    masterLimiter.ratio.setValueAtTime(1.0, audioCtx.currentTime);
    masterLimiter.attack.setValueAtTime(0.003, audioCtx.currentTime);
    masterLimiter.release.setValueAtTime(0.01, audioCtx.currentTime);

    preGain.connect(masterLimiter);
    masterLimiter.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    return { audioCtx, preGain, masterLimiter, masterGain };
  }).subscriptions(({ audioCtx, preGain }) => {
    const oscillators: Record<string, ReturnType<typeof voice> | null> = {};
    return [
      $onRelease.subscribe((note) => {
        oscillators[noteToString(note)]?.stop();
        oscillators[noteToString(note)] = null;
      }),
      $onPress.subscribe((note) => {
        if (oscillators[noteToString(note)]) return;

        oscillators[noteToString(note)] = voice(audioCtx, preGain, note, $envelope.value, $osc.value);
      }),
    ];
  });

export const { ModelProvider: SynthProvider, useModel: useSynth } = rxModelReact('synth', synth);
