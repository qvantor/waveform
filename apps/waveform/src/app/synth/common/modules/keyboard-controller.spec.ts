import { appModel } from '../../../app/modules/app-module';
import { createSpiedInputController, initModel, stopModels } from '../../../../test-utils/models';
import { keyboardController } from './keyboard-controller';

const setup = () => {
  const app = initModel(appModel(), 'appModel', undefined);
  const { module, onPress, onRelease } = createSpiedInputController();
  const [model, actions] = initModel(
    keyboardController({ app, inputController: module }),
    'keyboardController',
    undefined
  );
  return { onPress, onRelease, model, actions };
};

const key = (
  type: 'keydown' | 'keyup',
  code: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document
) => {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('keyboardController', () => {
  it.each([
    ['KeyZ', [3, 'C']],
    ['KeyQ', [4, 'C']],
    ['Digit2', [4, 'C#']],
    ['KeyI', [5, 'C']],
  ])('maps %s to %o', (code, note) => {
    const { onPress } = setup();
    key('keydown', code);
    expect(onPress).toHaveBeenCalledWith(note);
  });

  it('presses and releases notes on keydown/keyup', () => {
    const { onPress, onRelease } = setup();

    const down = key('keydown', 'KeyQ');
    expect(onPress).toHaveBeenCalledWith([4, 'C']);
    expect(down.defaultPrevented).toBe(true);

    key('keyup', 'KeyQ');
    expect(onRelease).toHaveBeenCalledWith([4, 'C']);
  });

  it('ignores keys without a note', () => {
    const { onPress, onRelease } = setup();
    const down = key('keydown', 'KeyA');
    key('keyup', 'KeyA');
    expect(onPress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(false);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])('ignores shortcuts with %o', (modifier) => {
    const { onPress } = setup();
    const down = key('keydown', 'KeyZ', modifier);
    expect(onPress).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(false);
  });

  it.each(['input', 'textarea'])('does not play notes while typing into %s', (tag) => {
    const { onPress } = setup();
    const field = document.body.appendChild(document.createElement(tag));
    const down = key('keydown', 'KeyZ', {}, field);
    expect(onPress).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(false);
  });

  it('plays notes on a focused select and keeps them from its type-ahead', () => {
    const { onPress } = setup();
    const select = document.body.appendChild(document.createElement('select'));
    select.focus();

    const down = key('keydown', 'KeyC', {}, select);
    expect(onPress).toHaveBeenCalledWith([3, 'E']);
    expect(down.defaultPrevented).toBe(true);

    // the arrows still step through its options
    expect(key('keydown', 'ArrowDown', {}, select).defaultPrevented).toBe(false);
  });

  it('releases a note even if keyup happens in a text field', () => {
    const { onRelease } = setup();
    const input = document.body.appendChild(document.createElement('input'));
    key('keydown', 'KeyZ');
    key('keyup', 'KeyZ', {}, input);
    expect(onRelease).toHaveBeenCalledWith([3, 'C']);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])('releases a note let go with %o held', (modifier) => {
    const { onRelease } = setup();
    key('keydown', 'KeyZ');
    key('keyup', 'KeyZ', modifier);
    expect(onRelease).toHaveBeenCalledWith([3, 'C']);
  });

  it('releases only the notes its keys pressed: not those of another input', () => {
    const { onRelease } = setup();
    // a shortcut, a key typed into a text field
    key('keydown', 'KeyZ', { ctrlKey: true });
    key('keyup', 'KeyZ', { ctrlKey: true });
    const input = document.body.appendChild(document.createElement('input'));
    key('keydown', 'KeyC', {}, input);
    key('keyup', 'KeyC', {}, input);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('releases the held notes when Cmd is released: macOS sends no keyup of a key let go meanwhile', () => {
    const { onRelease } = setup();
    key('keydown', 'KeyZ');
    key('keydown', 'KeyX');
    key('keyup', 'MetaLeft', { key: 'Meta' });
    expect(onRelease.mock.calls).toEqual([[[3, 'C']], [[3, 'D']]]);
    // their keyups after that release nothing again
    key('keyup', 'KeyZ');
    expect(onRelease).toHaveBeenCalledTimes(2);
  });

  it('releases the held notes when the window loses focus', () => {
    const { onRelease } = setup();
    key('keydown', 'KeyZ');
    key('keydown', 'KeyQ');
    window.dispatchEvent(new Event('blur'));
    expect(onRelease.mock.calls).toEqual([[[3, 'C']], [[4, 'C']]]);
  });

  it('a note two keys hold (Comma and Q) is pressed by the first and released by the last', () => {
    const { onPress, onRelease } = setup();
    key('keydown', 'Comma');
    key('keydown', 'KeyQ');
    expect(onPress.mock.calls).toEqual([[[4, 'C']]]);
    key('keyup', 'Comma');
    expect(onRelease).not.toHaveBeenCalled();
    key('keyup', 'KeyQ');
    expect(onRelease.mock.calls).toEqual([[[4, 'C']]]);
  });

  it.each([
    ['Cmd is released', () => key('keyup', 'MetaLeft', { key: 'Meta' })],
    ['the window loses focus', () => window.dispatchEvent(new Event('blur'))],
  ])('releases a note two keys hold once when %s', (_, releaseAll) => {
    const { onRelease } = setup();
    key('keydown', 'Comma');
    key('keydown', 'KeyQ');
    releaseAll();
    expect(onRelease.mock.calls).toEqual([[[4, 'C']]]);
  });

  describe('the octave', () => {
    it('shifts the notes of the keys', () => {
      const { onPress, model, actions } = setup();
      expect(model.$octave.value).toBe(3);
      actions.shiftOctave(1);
      key('keydown', 'KeyZ');
      key('keydown', 'BracketRight');
      expect(onPress.mock.calls).toEqual([[[4, 'C']], [[6, 'G']]]);
      actions.setOctave(0);
      key('keydown', 'KeyQ');
      expect(onPress).toHaveBeenLastCalledWith([1, 'C']);
    });

    it('releases the note a key pressed before a shift, not the one of the new octave', () => {
      const { onPress, onRelease, actions } = setup();
      key('keydown', 'KeyZ');
      actions.shiftOctave(1);
      key('keyup', 'KeyZ');
      expect(onRelease.mock.calls).toEqual([[[3, 'C']]]);
      // pressed again, the key plays the new octave
      key('keydown', 'KeyZ');
      expect(onPress).toHaveBeenLastCalledWith([4, 'C']);
    });

    it('releases the notes held across a shift when Cmd is released or the window loses focus', () => {
      const { onRelease, actions } = setup();
      key('keydown', 'KeyZ');
      actions.shiftOctave(-1);
      key('keydown', 'KeyX');
      key('keyup', 'MetaLeft', { key: 'Meta' });
      expect(onRelease.mock.calls).toEqual([[[3, 'C']], [[2, 'D']]]);

      key('keydown', 'KeyC');
      actions.shiftOctave(2);
      window.dispatchEvent(new Event('blur'));
      expect(onRelease).toHaveBeenLastCalledWith([2, 'E']);
      expect(onRelease).toHaveBeenCalledTimes(3);
    });

    it('presses nothing on the auto-repeat of a held key, a shift meanwhile too', () => {
      const { onPress, actions } = setup();
      key('keydown', 'KeyZ');
      actions.shiftOctave(1);
      const repeat = key('keydown', 'KeyZ', { repeat: true });
      expect(onPress.mock.calls).toEqual([[[3, 'C']]]);
      // it still keeps the key from the page
      expect(repeat.defaultPrevented).toBe(true);
    });

    it.each([
      ['ArrowUp', 4],
      ['ArrowDown', 2],
    ])('%s shifts it and keeps the page from scrolling', (code, octave) => {
      const { model } = setup();
      const down = key('keydown', code);
      expect(model.$octave.value).toBe(octave);
      expect(down.defaultPrevented).toBe(true);
    });

    it('steps once a press: not on the auto-repeat', () => {
      const { model } = setup();
      key('keydown', 'ArrowUp');
      const repeat = key('keydown', 'ArrowUp', { repeat: true });
      expect(model.$octave.value).toBe(4);
      expect(repeat.defaultPrevented).toBe(true);
    });

    it.each([{ metaKey: true }, { ctrlKey: true }])('the arrows do not shift it with %o', (modifier) => {
      const { model } = setup();
      const down = key('keydown', 'ArrowUp', modifier);
      expect(model.$octave.value).toBe(3);
      expect(down.defaultPrevented).toBe(false);
    });

    it.each(['input', 'textarea', 'select'])('the arrows do not shift it in a focused %s', (tag) => {
      const { model } = setup();
      const down = key('keydown', 'ArrowDown', {}, document.body.appendChild(document.createElement(tag)));
      expect(model.$octave.value).toBe(3);
      expect(down.defaultPrevented).toBe(false);
    });

    it('the arrows do not shift it once a control took them (a fader, a strip of values, tabs)', () => {
      const { model } = setup();
      const fader = document.body.appendChild(document.createElement('div'));
      fader.setAttribute('role', 'slider');
      fader.addEventListener('keydown', (e) => e.preventDefault());
      key('keydown', 'ArrowUp', {}, fader);
      expect(model.$octave.value).toBe(3);
    });

    it('a note its key and a key of another octave hold sounds until both are let go', () => {
      const { onPress, onRelease, actions } = setup();
      key('keydown', 'KeyQ');
      actions.shiftOctave(1);
      key('keydown', 'KeyZ');
      expect(onPress.mock.calls).toEqual([[[4, 'C']]]);
      key('keyup', 'KeyQ');
      expect(onRelease).not.toHaveBeenCalled();
      key('keyup', 'KeyZ');
      expect(onRelease.mock.calls).toEqual([[[4, 'C']]]);
    });

    it('the arrows do not shift it once a listener of the document added later took them (a keyboard drag)', () => {
      const { model } = setup();
      const drag = (e: KeyboardEvent) => e.preventDefault();
      document.addEventListener('keydown', drag);
      try {
        key('keydown', 'ArrowDown');
        expect(model.$octave.value).toBe(3);
      } finally {
        document.removeEventListener('keydown', drag);
      }
    });

    it('the arrows do not shift it in a dialog: its lists scroll', () => {
      const { model } = setup();
      const dialog = document.body.appendChild(document.createElement('div'));
      dialog.setAttribute('role', 'dialog');
      const row = dialog.appendChild(document.createElement('div'));
      const down = key('keydown', 'ArrowDown', {}, row);
      expect(model.$octave.value).toBe(3);
      expect(down.defaultPrevented).toBe(false);
    });

    it('the arrows shift it from a focused control that takes none of them (a tab of a source)', () => {
      const { model } = setup();
      const tab = document.body.appendChild(document.createElement('button'));
      tab.setAttribute('role', 'tab');
      key('keydown', 'ArrowUp', {}, tab);
      expect(model.$octave.value).toBe(4);
    });

    it.each([
      [0, 'ArrowDown', -1],
      [6, 'ArrowUp', 1],
    ])('stays at %i, the end of its range', (end, code, diff) => {
      const { model, actions } = setup();
      actions.setOctave(end);
      key('keydown', code);
      actions.shiftOctave(diff);
      actions.setOctave(end + diff);
      expect(model.$octave.value).toBe(end);
    });

    it('is kept by the browser', () => {
      const { actions } = setup();
      expect(localStorage.getItem('keyboardOctave')).toBeNull();
      actions.shiftOctave(1);
      expect(localStorage.getItem('keyboardOctave')).toBe('4');
      stopModels();

      localStorage.setItem('keyboardOctave', '2');
      const { onPress, model } = setup();
      expect(model.$octave.value).toBe(2);
      key('keydown', 'KeyZ');
      expect(onPress).toHaveBeenCalledWith([2, 'C']);
    });

    it.each(['2.5', '7', '-1', '"4"', 'x'])('reads a broken stored value %s as 3', (stored) => {
      localStorage.setItem('keyboardOctave', stored);
      const { model } = setup();
      expect(model.$octave.value).toBe(3);
    });
  });

  it('stops listening after stop', () => {
    const { onPress } = setup();
    stopModels();
    key('keydown', 'KeyZ');
    expect(onPress).not.toHaveBeenCalled();
  });
});
