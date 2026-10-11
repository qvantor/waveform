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
