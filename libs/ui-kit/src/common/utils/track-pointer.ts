// follows one pointer (mouse, finger) from pointerdown until it is released or cancelled, or lost (`onEnd(true)`): a
// move without a button (its pointerup went outside the window) or the window losing focus (Cmd+Tab: its pointerup
// goes to another app). Else the control would stay held, follow the mouse and take no press
export const trackPointer = (
  { pointerId }: { pointerId: number },
  onMove?: (e: PointerEvent) => void,
  onEnd?: (lost: boolean) => void
) => {
  const stop = (lost: boolean) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
    window.removeEventListener('blur', blur);
    onEnd?.(lost);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (e.buttons === 0) stop(true);
    else onMove?.(e);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId === pointerId) stop(false);
  };
  const blur = () => stop(true);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  window.addEventListener('blur', blur);
};

// lets a control follow one pointer at a time: extra fingers and non-main mouse buttons are ignored
// while it is held. Returns false when the pointer is not tracked.
export const singlePointerTracker = () => {
  let active = false;
  return (
    e: { pointerId: number; button: number },
    onMove?: (e: PointerEvent) => void,
    onEnd?: (lost: boolean) => void
  ) => {
    if (active || e.button !== 0) return false;
    active = true;
    trackPointer(e, onMove, (lost) => {
      active = false;
      onEnd?.(lost);
    });
    return true;
  };
};
