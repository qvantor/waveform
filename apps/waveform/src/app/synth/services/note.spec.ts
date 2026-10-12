import { Note } from '@waveform/ui-kit';
import { getFq, noteToString, stringToNote } from './note';

describe('note', () => {
  it('getFq returns 440 Hz for A4 and doubles per octave', () => {
    expect(getFq([4, 'A'])).toBeCloseTo(440);
    expect(getFq([5, 'A'])).toBeCloseTo(880);
    expect(getFq([3, 'A'])).toBeCloseTo(220);
    expect(getFq([4, 'C'])).toBeCloseTo(261.63, 2);
  });

  it('noteToString joins note and octave', () => {
    expect(noteToString([4, 'C#'])).toBe('C#4');
    expect(noteToString([0, 'A'])).toBe('A0');
  });

  it.each<Note>([
    [4, 'C'],
    [3, 'C#'],
    [0, 'B'],
    [9, 'G#'],
    [-1, 'C#'],
    [-1, 'A'],
  ])('stringToNote parses noteToString output back (%s %s)', (...note) => {
    expect(stringToNote(noteToString(note))).toEqual(note);
  });
});
