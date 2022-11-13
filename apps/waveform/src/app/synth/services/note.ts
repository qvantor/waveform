import { Note, Notes } from '@waveform/ui-kit';
import { noteFrequency } from '../../common/constants';

export const getFq = ([octave, note]: Note) => noteFrequency[note] * 2 ** (octave - 1);
export const noteToString = ([octave, note]: Note) => `${note}${octave}`;
export const stringToNote = (value: string): Note => {
  const octave = value.slice(-1);
  const note = value.replace(octave, '');
  return [Number(octave), note as Notes];
};
