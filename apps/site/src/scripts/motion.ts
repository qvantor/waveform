// What the moving parts of the page share (art.ts, scenes.ts, video.ts): whether the reader asked for reduced
// motion, and a canvas at the pixels of its box.

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// the canvas at the pixels of a box: its CSS size × the pixel ratio of the screen, at most `maxRatio`
export const sizeCanvas = (canvas: HTMLCanvasElement, box: Element, maxRatio = Infinity) => {
  const ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
  const { width, height } = box.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  return { width, height, ratio };
};
