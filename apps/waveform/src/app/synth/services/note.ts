import { Note, Notes } from '@waveform/ui-kit';
import { noteFrequency } from '../../common/constants';

export const getFq = ([octave, note]: Note) => noteFrequency[note] * 2 ** (octave - 1);
export const noteToString = ([octave, note]: Note) => `${note}${octave}`;
export const stringToNote = (value: string): Note => {
  // the octave may be negative (C-1 is MIDI note 0)
  const [, note, octave] = value.match(/^(.+?)(-?\d+)$/) ?? [];
  return [Number(octave), note as Notes];
};
