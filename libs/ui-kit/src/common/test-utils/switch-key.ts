import { jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react';
import { SWITCH_KEY_TIP_DELAY } from '../../switch-key';

// hovers a SwitchKey (its wrapper: a disabled button takes no mouse events) as long as its tooltip waits; fake timers
export const hoverSwitchKey = (key: HTMLElement) => {
  fireEvent.mouseEnter(key.parentElement as HTMLElement);
  act(() => {
    jest.advanceTimersByTime(SWITCH_KEY_TIP_DELAY);
  });
};

// the text of the tooltip of the SwitchKey of `name`, hovered and left again; the tooltips shown before stay in the
// document, hidden: the one of the key by its name
export const switchKeyTip = (name: string) => {
  const key = screen.getByRole('button', { name });
  hoverSwitchKey(key);
  const tooltip = screen.getAllByRole('tooltip').find((tip) => tip.textContent?.startsWith(name));
  fireEvent.mouseLeave(key.parentElement as HTMLElement);
  act(() => {
    jest.advanceTimersByTime(SWITCH_KEY_TIP_DELAY);
  });
  return tooltip?.textContent;
};
