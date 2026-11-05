import { createInputController } from '../../../../test-utils/models';
import { NoteOn } from './input-controller';

describe('inputController', () => {
  it('emits pressed notes and tracks them per octave', () => {
    const [{ $onPress, $pressed }, { onPress }] = createInputController();
    const pressed: NoteOn[] = [];
    $onPress.subscribe((note) => pressed.push(note));

    onPress([4, 'C']);
    onPress([4, 'E'], 30);
    onPress([-1, 'A'], 127);

    // the computer keyboard and the piano play 100
    expect(pressed).toEqual([
      { note: [4, 'C'], velocity: 100 },
      { note: [4, 'E'], velocity: 30 },
      { note: [-1, 'A'], velocity: 127 },
    ]);
    expect($pressed.value[4]).toEqual(['C', 'E']);
    expect($pressed.value[-1]).toEqual(['A']);
    expect($pressed.value[3]).toEqual([]);
  });

  it('ignores a note that is already pressed', () => {
    const [{ $onPress, $pressed }, { onPress }] = createInputController();
    const listener = jest.fn();
    $onPress.subscribe(listener);

    onPress([4, 'C']);
    onPress([4, 'C']);

    expect(listener).toHaveBeenCalledTimes(1);
    expect($pressed.value[4]).toEqual(['C']);
  });

  it('emits released notes and removes them from pressed', () => {
    const [{ $onRelease, $pressed }, { onPress, onRelease }] = createInputController();
    const listener = jest.fn();
    $onRelease.subscribe(listener);

    onPress([4, 'C']);
    onPress([4, 'E']);
    onRelease([4, 'C']);

    expect(listener).toHaveBeenCalledWith([4, 'C']);
    expect($pressed.value[4]).toEqual(['E']);
  });

  it('allows pressing a note again after release', () => {
    const [{ $onPress }, { onPress, onRelease }] = createInputController();
    const listener = jest.fn();
    $onPress.subscribe(listener);

    onPress([4, 'C']);
    onRelease([4, 'C']);
    onPress([4, 'C']);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('holds the pitch bend at rest until it is set', () => {
    const [{ $bend }, { setBend }] = createInputController();
    expect($bend.value).toBe(0);
    setBend(-0.25);
    expect($bend.value).toBe(-0.25);
  });
});
