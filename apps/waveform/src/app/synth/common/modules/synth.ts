import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { InputControllerModule } from './input-controller';
import { Note } from '@waveform/ui-kit';
import { noteFrequency } from '../../../common/constants';

interface Deps {
  inputController: InputControllerModule;
}

const config = {
  attack: 0.005,
  hold: 0.1,
  decay: 0.05,
  sustain: 0.4, // Gain
  release: 0.005,
};

const getFq = ([octave, note]: Note) => noteFrequency[note] * 2 ** (octave - 1);
const noteToString = ([octave, note]: Note) => `${note}${octave}`;

const voice = (audioCtx: AudioContext, note: Note) => {
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  oscillator.type = 'triangle';

  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  oscillator.frequency.setValueAtTime(getFq(note), now);
  // Attack
  gain.gain.linearRampToValueAtTime(1, now + config.attack);
  gain.gain.setValueAtTime(1, now + config.attack);

  // Hold
  gain.gain.linearRampToValueAtTime(1, now + config.attack + config.hold);

  // Decay and sustain
  gain.gain.linearRampToValueAtTime(config.sustain, now + config.attack + config.hold + config.decay);

  oscillator.start(now);
  const stop = () => {
    const now = audioCtx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.001, now + config.release);
    oscillator.stop(audioCtx.currentTime + config.release);
  };
  return { stop };
};

const synth = ({ inputController: [{ $onPress, $onRelease }] }: Deps) =>
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

        oscillators[noteToString(note)] = voice(audioCtx, note);
      }),
    ];
  });

export const { ModelProvider: SynthProvider, useModel: useSynth } = rxModelReact('synth', synth);
