import { isScene, sceneAt, type Scene, type SceneLine } from '../art/scenes';

// The waves behind the features (art/scenes.ts) on a canvas of each section: drawn about FPS times a second while
// the section is on screen, one still frame where the reader asked for reduced motion; nothing without a 2D context.
// A level of 1 is AMPLITUDE of the section's height from its middle, at most MAX_AMPLITUDE pixels; the canvas at
// most 1.5 pixels a CSS pixel (faint lines need no more).

export const FPS = 30;
const AMPLITUDE = 0.3;
const MAX_AMPLITUDE = 220;
const MAX_RATIO = 1.5;

type Item = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  scene: Scene;
  visible: boolean;
  width: number;
  height: number;
  // sized (or not drawn yet) since its last drawing
  stale: boolean;
};

const draw = ({ context, scene, width, height }: Item, time: number) => {
  context.clearRect(0, 0, width, height);
  const middle = height / 2;
  const amplitude = Math.min(height * AMPLITUDE, MAX_AMPLITUDE);
  const line = ({ points, color, alpha, width: thickness, glow = 0, dash, dot }: SceneLine) => {
    context.beginPath();
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i] * width;
      const y = middle - points[i + 1] * amplitude;
      if (i) context.lineTo(x, y);
      else context.moveTo(x, y);
    }
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = thickness;
    context.shadowColor = color;
    context.shadowBlur = glow;
    context.setLineDash(dash ?? []);
    context.stroke();
    if (dot) {
      context.beginPath();
      context.arc(dot[0] * width, middle - dot[1] * amplitude, 4, 0, 2 * Math.PI);
      context.fillStyle = color;
      context.fill();
    }
  };
  for (const part of sceneAt(scene, time)) line(part);
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.setLineDash([]);
};

export const animateScenes = (root: ParentNode = document) => {
  const items = [...root.querySelectorAll<HTMLCanvasElement>('canvas[data-scene]')].flatMap(
    (canvas): Item[] => {
      const scene = canvas.dataset['scene'] ?? '';
      const context = canvas.getContext('2d');
      return isScene(scene) && context
        ? [{ canvas, context, scene, visible: false, width: 0, height: 0, stale: true }]
        : [];
    }
  );
  if (!items.length) return 0;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const start = performance.now();
  const now = () => (still ? 0 : (performance.now() - start) / 1000);

  // the canvas at the pixels of its box, the drawing in CSS pixels; drawn when it is seen (a canvas off screen
  // costs nothing)
  const fit = (item: Item) => {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_RATIO);
    const { width, height } = item.canvas.getBoundingClientRect();
    item.width = width;
    item.height = height;
    item.canvas.width = Math.max(1, Math.round(width * ratio));
    item.canvas.height = Math.max(1, Math.round(height * ratio));
    item.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    item.context.lineJoin = 'round';
    item.stale = true;
  };

  let frame = 0;
  let last = 0;
  const tick = (time: number) => {
    frame = 0;
    const visible = items.filter((item) => item.visible);
    if (!visible.length) return;
    const due = !still && time - last >= 1000 / FPS - 2;
    if (due) last = time;
    for (const item of visible) {
      if (!due && !item.stale) continue;
      draw(item, now());
      item.stale = false;
    }
    // with reduced motion a still frame each, once
    if (!still || visible.some((item) => item.stale)) frame = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!frame && items.some((item) => item.visible && (!still || item.stale)))
      frame = requestAnimationFrame(tick);
  };

  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const item = items.find(({ canvas }) => canvas === entry.target);
      if (item) fit(item);
    }
    wake();
  });
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const item = items.find(({ canvas }) => canvas === entry.target);
      if (item) item.visible = entry.isIntersecting;
    }
    wake();
  });
  for (const item of items) {
    resize.observe(item.canvas);
    seen.observe(item.canvas);
  }
  return items.length;
};

// after the page has painted, when the main thread is idle (the waves are behind it)
export const animateScenesWhenIdle = (root: ParentNode = document) => {
  const start = () => animateScenes(root);
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 2000 });
  else setTimeout(start, 200);
};
