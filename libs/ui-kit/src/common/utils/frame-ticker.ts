// one requestAnimationFrame loop for every subscriber (the live marks of the modulated controls, the meters of the
// output), running while one is: many controls don't each schedule a frame of their own
const subscribers = new Set<(time: number) => void>();
// the frame scheduled (0: none; while the subscribers are called, none yet: one that subscribes then schedules it)
let frame = 0;

const tick = (time: number) => {
  frame = 0;
  subscribers.forEach((callback) => callback(time));
  if (subscribers.size > 0 && !frame) frame = window.requestAnimationFrame(tick);
};

// calls `callback` every frame (with the timestamp of the frame, ms) until the returned function is called
export const onFrame = (callback: (time: number) => void) => {
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
