import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { KILL_FADE } from '../wavetable/voice-options';
import type { FxModule } from '../../fx/modules/fx';
import { OscillatorModule } from './oscillator';
import type { SynthModule } from './synth';
import { SynthCoreModule } from './synth-core';

interface Deps {
  synthCore: SynthCoreModule;
  synth: SynthModule;
  fx: FxModule;
  oscillator: [OscillatorModule, OscillatorModule];
}

// seconds of silence after the next preset is applied: the clear messages reach the worklets before the
// output opens
const SWITCH_LEAD = 0.01;
// ms: a context that runs but whose clock doesn't move (an iOS interruption) isn't waited for longer
const MAX_CLOCK_WAIT = 200;
// ms: a table still loading by then (a slow network, its retries) doesn't keep the synth silent: the output
// opens, the table before plays until it comes (OscillatorStatus shows a failed one)
const MAX_SILENCE = 2000;
const POLL = 10;

// a preset switch silences the synth: no mix of the presets (the voices and the tails of the one before with the
// knobs of the next one, the knobs of the next one on the tables of the one before). The output (fxOut, after
// the tails of the fx) fades out as a stolen voice does (KILL_FADE) and the voices with it, the keys held wait
// (synth pause); once the audio thread has rendered the silence the preset is applied (the chain rewired then
// doesn't click) and the fx and the limiter forget the sound before (after it: the delay makes its nodes at the
// knobs of the preset, from those before Time would glide); the output opens at once (nothing sounds before it,
// a fade would take the attacks of the keys) when the tables of its oscillators on are played, then the keys
// still held start on it (synth resume). A preset chosen meanwhile replaces one waiting for the fade, after it is
// applied at once (the synth is silent) and the wait starts again. A context that doesn't run isn't waited for,
// a clock that doesn't move MAX_CLOCK_WAIT at most at either stage. A preset that throws doesn't keep the synth
// silent: its error goes on, the sound before is forgotten all the same and the output opens on what it set
const createSoundSwitch = ({
  synthCore: [{ audioCtx, masterLimiter, wavetables }, { mute, unmute }],
  synth: [{ voicing }, { pause, resume }],
  fx: [, { clear }],
  oscillator,
}: Deps) => {
  // set while it switches (the poll of its stage)
  let timer: ReturnType<typeof setTimeout> | undefined;
  // the preset waiting for the fade
  let pending: (() => void) | null = null;
  // the seconds of the context the stage waits for, and its start (performance.now)
  let until = 0;
  let since = 0;

  const wait = (seconds: number) => {
    until = audioCtx.currentTime + seconds;
    since = performance.now();
  };
  const reached = () => audioCtx.state !== 'running' || audioCtx.currentTime >= until;
  const waited = () => performance.now() - since;
  // the stage is over: the context rendered it, or its clock stands
  const passed = () => reached() || waited() >= MAX_CLOCK_WAIT;
  // the voices it faded out have ended: a processor sees the gate a block or a device buffer after the main
  // thread set it, at the clock alone their last samples would reach the fx it clears (a context that doesn't
  // run ends none)
  const faded = () =>
    (reached() && (audioCtx.state !== 'running' || voicing.silent)) || waited() >= MAX_CLOCK_WAIT;
  // an oscillator that isn't ready plays no note anyway
  const tablesPlayed = () =>
    wavetables.$status.value !== 'ready' ||
    oscillator.every(([{ $active, tablePlayed }]) => !$active.value || tablePlayed());

  const apply = (next: () => void) => {
    pending = null;
    try {
      next();
    } finally {
      clear();
      masterLimiter.clear();
      wait(SWITCH_LEAD);
    }
  };

  const poll = () => {
    timer = undefined;
    try {
      if (pending && faded()) apply(pending);
    } finally {
      if (pending || (!(passed() && tablesPlayed()) && waited() < MAX_SILENCE)) {
        timer = setTimeout(poll, POLL);
      } else {
        unmute();
        resume();
      }
    }
  };

  return {
    switchSound: (next: () => void) => {
      if (pending) pending = next;
      else if (timer !== undefined) apply(next);
      else {
        pending = next;
        mute(KILL_FADE);
        pause();
        wait(KILL_FADE);
        poll();
      }
    },
    destroy: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
};

export const soundSwitch = (deps: Deps) =>
  rxModel(() => createSoundSwitch(deps))
    .actions(({ switchSound }) => ({ switchSound }))
    .destroy(({ destroy }) => destroy());

export const { ModelProvider: SoundSwitchProvider, useModel: useSoundSwitch } = rxModelReact(
  'soundSwitch',
  soundSwitch
);

export type SoundSwitchModule = ReturnType<typeof useSoundSwitch>;
