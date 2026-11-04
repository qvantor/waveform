import { pianoOctaves, pianoStarts } from './piano-octaves';

describe('pianoStarts', () => {
  it.each([
    [1, [0, 8]],
    [2, [0, 7]],
    [3, [0, 6]],
    [5, [0, 4]],
  ])('%i octaves start within %o: their last one is 8 at most', (count, starts) => {
    expect(pianoStarts(count)).toEqual(starts);
  });
});

describe('pianoOctaves', () => {
  it.each([
    // by default from the octave under the computer keyboard, at any width
    [3, 5, [2, 6]],
    [3, 4, [2, 5]],
    [3, 3, [2, 4]],
    [3, 2, [2, 3]],
    [3, 1, [2, 2]],
    // the lowest octaves of the keys: from 0
    [1, 3, [0, 2]],
    [0, 5, [0, 4]],
    // the highest ones: up to 8, G8 the top of the computer keyboard
    [6, 5, [4, 8]],
    [6, 4, [5, 8]],
    [6, 3, [5, 7]],
  ])('the keys at %i, %i octaves: %o', (octave, count, octaves) => {
    expect(pianoOctaves(octave, count)).toEqual(octaves);
  });
});
