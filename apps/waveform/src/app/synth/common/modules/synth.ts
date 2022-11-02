import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { InputControllerModule } from './input-controller';
import { AdsrEnvelopeModule, AdsrEnvelopeModel } from './adsr-envelope';
import { OscillatorModule } from './oscillator';
import { Note } from '@waveform/ui-kit';
import { noteFrequency } from '../../../common/constants';

interface Deps {
  inputController: InputControllerModule;
  adsrEnvelope: AdsrEnvelopeModule;
  oscillator: [OscillatorModule, OscillatorModule];
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
    oscillator.setPeriodicWave(config.wave);

    if (config.unison !== 1) oscillator.detune.setValueAtTime(from + step * i, audioCtx.currentTime);
    oscillator.frequency.setValueAtTime(config.frequency, audioCtx.currentTime);
    oscillators.push(oscillator);
  }

  const start = (time?: number) =>
    oscillators.forEach(
      (oscillator) => oscillator.start((time ?? audioCtx.currentTime) + Math.random() * config.randPhase) // starts with random phase
    );
  const setWave = (wave: PeriodicWave) =>
    oscillators.forEach((oscillator) => oscillator.setPeriodicWave(wave));
  const connect = (node: AudioNode) => oscillators.forEach((oscillator) => oscillator.connect(node));
  const stop = (time?: number) => oscillators.forEach((oscillator) => oscillator.stop(time));

  return { start, connect, setWave, stop };
};

const voice = (
  audioCtx: AudioContext,
  outputNode: AudioNode,
  note: Note,
  adsrConfig: AdsrEnvelopeModel['$envelope']['value'],
  oscConfigs: Array<Omit<OscillatorConfig, 'frequency'>>
) => {
  const uOscs = oscConfigs.map((oscConfig) =>
    unisonOscillator(audioCtx, {
      ...oscConfig,
      frequency: getFq(note),
    })
  );

  const adsr = envelope(audioCtx, adsrConfig);
  uOscs.forEach((uOsc) => uOsc.connect(adsr.envelope));
  adsr.envelope.connect(outputNode);

  uOscs.forEach((uOsc) => uOsc.start());
  const stop = () => {
    adsr.stop();
    uOscs.forEach((uOsc) => uOsc.stop(audioCtx.currentTime + adsrConfig.release));
  };
  const setWave = (wave: PeriodicWave) => {
    console.log(wave);
  };
  return { stop, setWave };
};

const synth = ({
  inputController: [{ $onPress, $onRelease }],
  adsrEnvelope: [{ $envelope }],
  oscillator: oscillators,
}: Deps) =>
  rxModel(() => {
    const audioCtx = new window.AudioContext();
    const preGain = audioCtx.createGain();
    const masterLimiter = audioCtx.createDynamicsCompressor();
    const masterGain = audioCtx.createGain();
    preGain.gain.setValueAtTime(0.2, audioCtx.currentTime);
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
    const voices: Record<string, ReturnType<typeof voice> | null> = {};
    return [
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
          oscillators.map(([oscillator]) => ({
            ...oscillator.$osc.value,
            wave: oscillator.$periodicWave.value,
          }))
        );
      }),
      // $periodicWave.subscribe((wave) => {
      //   for (const voice in voices) {
      //     voices[voice]?.setWave(wave);
      //   }
      // }),
    ];
  });

export const { ModelProvider: SynthProvider, useModel: useSynth } = rxModelReact('synth', synth);
