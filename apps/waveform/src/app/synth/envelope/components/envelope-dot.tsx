import React from 'react';
import { combineLatest, distinctUntilChanged, map } from 'rxjs';
import { NoteDot } from '@waveform/ui-kit';
import { useObservable } from '@waveform/rxjs-react';
import { EnvelopeId, ENVELOPES } from '@waveform/preset-schema';
import { ModRoute } from '../../common/modules/modulation';
import { useModulation, useSynth, useSynthCore } from '../../common/modules';
import type { EnvelopeParams } from '../../common/envelope/envelope-curve';
import { noteCorners, outputTime } from '../note-path';

// an envelope is heard: ENV 1 always (the volume of the voices), ENV 2 and 3 while a route reads them
const heard = (id: EnvelopeId, routes: ModRoute[]) =>
  id === 'env1' || routes.some(({ source }) => source === id);

// the dot of the last note pressed (the fx and the marks of the knobs follow it, in legato its phrase) on the
// chart of envelope `id` while it is heard: on the line of `env` (the knobs the chart draws, not those of the
// note on: a knob turned while it plays moves the dot with the line), from the time the output plays its start.
// Only the dot renders on a note on and off (none while it isn't heard), and a new amount renders nothing.
// Keyed by `id` (a tab mounts its own: its first render doesn't take the note of the last one)
export const EnvelopeDot = ({ id, env }: { id: EnvelopeId; env: EnvelopeParams }) => {
  const [{ $fxNote }] = useSynth();
  const [{ audioCtx }] = useSynthCore();
  const [{ $routes }] = useModulation();
  const $note = React.useMemo(
    () =>
      combineLatest([$routes, $fxNote]).pipe(
        map(([routes, note]) => (heard(id, routes) ? note : null)),
        distinctUntilChanged()
      ),
    [$routes, $fxNote, id]
  );
  const note = useObservable($note, heard(id, $routes.value) ? $fxNote.value : null);
  const noteStart = note?.start;
  // once per note: a knob turned or its release doesn't read the clock again
  const start = React.useMemo(
    () => (noteStart === undefined ? undefined : outputTime(audioCtx, noteStart)),
    [noteStart, audioCtx]
  );
  const path = React.useMemo(() => {
    if (!note || start === undefined) return null;
    const released = note.release === null ? null : note.release - note.start;
    const from = note.from?.[ENVELOPES.indexOf(id)];
    return { start, corners: noteCorners(env, released, from), held: released === null };
  }, [note, start, env, id]);
  return <NoteDot path={path} />;
};
