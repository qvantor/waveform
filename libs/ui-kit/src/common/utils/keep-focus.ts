import type React from 'react';

// the onMouseDown of a control a press doesn't focus, nor moves the focus from where it was: the keys stay those of
// the notes (Space or Enter would press a focused control)
export const keepFocus = (e: React.MouseEvent) => e.preventDefault();
