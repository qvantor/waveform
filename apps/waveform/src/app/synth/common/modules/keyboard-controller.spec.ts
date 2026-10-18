import { appModel } from '../../../app/modules/app-module';
import { createSpiedInputController, initModel, stopModels } from '../../../../test-utils/models';
import { keyboardController } from './keyboard-controller';

const setup = () => {
  const app = initModel(appModel(), 'appModel', undefined);
  const { module, onPress, onRelease } = createSpiedInputController();
  initModel(keyboardController({ app, inputController: module }), 'keyboardController', undefined);
  return { onPress, onRelease };
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
    key('keyup', 'KeyZ', {}, input);
    expect(onRelease).toHaveBeenCalledWith([3, 'C']);
  });

  it('stops listening after stop', () => {
    const { onPress } = setup();
    stopModels();
    key('keydown', 'KeyZ');
    expect(onPress).not.toHaveBeenCalled();
  });
});
