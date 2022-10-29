import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { InputControllerModule } from './input-controller';
import { AdsrEnvelopeModule, AdsrEnvelopeModel } from './adsr-envelope';
import { Note } from '@waveform/ui-kit';
import { noteFrequency } from '../../../common/constants';

interface Deps {
  inputController: InputControllerModule;
  adsrEnvelope: AdsrEnvelopeModule;
}

const getFq = ([octave, note]: Note) => noteFrequency[note] * 2 ** (octave - 1);
const noteToString = ([octave, note]: Note) => `${note}${octave}`;

const envelope = (audioCtx: AudioContext, config: AdsrEnvelopeModel['$envelope']['value']) => {
  const gain = audioCtx.createGain();

  const now = audioCtx.currentTime;

  // Attack
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
const voice = (audioCtx: AudioContext, note: Note, adsrConfig: AdsrEnvelopeModel['$envelope']['value']) => {
  const oscillator = audioCtx.createOscillator();
  const adsr = envelope(audioCtx, adsrConfig);
  oscillator.connect(adsr.envelope);
  adsr.envelope.connect(audioCtx.destination);

  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(getFq(note), audioCtx.currentTime);

  oscillator.start();
  const stop = () => {
    adsr.stop();
    oscillator.stop(audioCtx.currentTime + adsrConfig.release);
  };
  return { stop };
};

const synth = ({ inputController: [{ $onPress, $onRelease }], adsrEnvelope: [{ $envelope }] }: Deps) =>
  rxModel(() => {
    const audioCtx = new window.AudioContext();

    return { audioCtx };
  }).subscriptions(({ audioCtx }) => {
    const oscillators: Record<string, ReturnType<typeof voice> | null> = {};
    return [
      $onRelease.subscribe((note) => {
        oscillators[noteToString(note)]?.stop();
        oscillators[noteToString(note)] = null;
      }),
      $onPress.subscribe((note) => {
        if (oscillators[noteToString(note)]) return;

        oscillators[noteToString(note)] = voice(audioCtx, note, $envelope.value);
      }),
    ];
  });

export const { ModelProvider: SynthProvider, useModel: useSynth } = rxModelReact('synth', synth);
