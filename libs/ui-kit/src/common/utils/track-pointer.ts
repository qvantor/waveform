// follows one pointer (mouse, finger) from pointerdown until it is released or cancelled
export const trackPointer = (
  { pointerId }: { pointerId: number },
  onMove?: (e: PointerEvent) => void,
  onEnd?: () => void
) => {
  const move = (e: PointerEvent) => {
    if (e.pointerId === pointerId) onMove?.(e);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
    onEnd?.();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
};

// lets a control follow one pointer at a time: extra fingers and non-main mouse buttons are ignored
// while it is held. Returns false when the pointer is not tracked.
export const singlePointerTracker = () => {
  let active = false;
  return (
    e: { pointerId: number; button: number },
    onMove?: (e: PointerEvent) => void,
    onEnd?: () => void
  ) => {
    if (active || e.button !== 0) return false;
    active = true;
    trackPointer(e, onMove, () => {
      active = false;
      onEnd?.();
    });
    return true;
  };
};
