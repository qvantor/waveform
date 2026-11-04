import { ART, artFrames, type ArtFrame } from '../art/wavetable';

// The wavetable behind the first section moving (art/wavetable.ts, `artFrames` of the time): drawn on a canvas over
// its still SVG (the same drawing at time 0, so nothing jumps), which hides once the canvas has drawn. Only while
// the section is on screen (and the tab shown: requestAnimationFrame); nothing moves where the reader asked for
// reduced motion, nor without a 2D context.

const FILL_TOP = 'rgba(46, 204, 113, 0.38)';
const FILL_BOTTOM = 'rgba(46, 204, 113, 0.03)';
const GLOW = 'rgba(46, 204, 113, 0.9)';

const draw = (context: CanvasRenderingContext2D, frames: ArtFrame[]) => {
  context.clearRect(0, 0, ART.width, ART.height);
  context.lineJoin = 'round';
  for (const frame of frames) {
    const { xy, glow } = frame;
    context.beginPath();
    context.moveTo(xy[0], xy[1]);
    for (let i = 2; i < xy.length; i += 2) context.lineTo(xy[i], xy[i + 1]);
    if (glow > 0) {
      // the played frame filled down to its zero line, as the synth draws it
      context.save();
      context.lineTo(frame.right, frame.zero);
      context.lineTo(frame.left, frame.zero);
      const fill = context.createLinearGradient(0, frame.zero - 90, 0, frame.zero);
      fill.addColorStop(0, FILL_TOP);
      fill.addColorStop(1, FILL_BOTTOM);
      context.globalAlpha = glow;
      context.fillStyle = fill;
      context.fill();
      context.restore();
      context.beginPath();
      context.moveTo(xy[0], xy[1]);
      for (let i = 2; i < xy.length; i += 2) context.lineTo(xy[i], xy[i + 1]);
      context.shadowColor = GLOW;
      context.shadowBlur = 14 * glow;
    } else context.shadowBlur = 0;
    context.globalAlpha = frame.alpha;
    context.strokeStyle = frame.color;
    context.lineWidth = 1.1 + 1.4 * glow;
    context.stroke();
  }
  context.globalAlpha = 1;
  context.shadowBlur = 0;
};

export const animateArt = (root: ParentNode = document) => {
  const box = root.querySelector<HTMLElement>('[data-art]');
  const canvas = box?.querySelector('canvas');
  const still = box?.querySelector('svg');
  if (!box || !canvas || !still) return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const context = canvas.getContext('2d');
  if (!context) return false;

  let frame = 0;
  let visible = false;
  const start = performance.now();
  // the canvas at the pixels of its box, the drawing in the units of the viewBox
  const fit = () => {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = box.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(canvas.width / ART.width, 0, 0, canvas.height / ART.height, 0, 0);
  };
  const tick = (now: number) => {
    draw(context, artFrames((now - start) / 1000));
    if (canvas.hidden) {
      canvas.hidden = false;
      still.style.visibility = 'hidden';
    }
    frame = visible ? requestAnimationFrame(tick) : 0;
  };
  const run = (on: boolean) => {
    visible = on;
    if (on && !frame) frame = requestAnimationFrame(tick);
    if (!on && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  fit();
  new ResizeObserver(fit).observe(box);
  new IntersectionObserver((entries) => run(entries.some((entry) => entry.isIntersecting))).observe(box);
  return true;
};
