// one requestAnimationFrame loop for every subscriber (the live dots of the amount rings), running while one is:
// many rings don't each schedule a frame of their own
const subscribers = new Set<() => void>();
let frame = 0;

const tick = () => {
  subscribers.forEach((callback) => callback());
  frame = subscribers.size > 0 ? window.requestAnimationFrame(tick) : 0;
};

// calls `callback` every frame until the returned function is called
export const onFrame = (callback: () => void) => {
  subscribers.add(callback);
  if (!frame) frame = window.requestAnimationFrame(tick);
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  };
};
