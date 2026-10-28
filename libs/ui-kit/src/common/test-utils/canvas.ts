// jsdom has no 2D context: a stub per canvas records what is drawn on it since the whole canvas was last cleared
// (the live charts and the marks clear it before every drawing). The specs of the app take it as
// `@waveform/ui-kit/test-utils`

type Rect = [number, number, number, number];
type Transform = [number, number, number, number, number, number];

// a path filled or stroked (or a rect filled), in the coordinates it was drawn in, with the style then
export interface DrawnShape {
  op: 'fill' | 'stroke';
  // the points of moveTo and lineTo, the arcs and the rects of the path
  points: [number, number][];
  arcs: { x: number; y: number; radius: number }[];
  rects: Rect[];
  closed: boolean;
  style: string;
  lineWidth: number;
  lineCap: string;
  alpha: number;
  // the rects of the clip it was drawn in (null: none)
  clip: Rect[] | null;
  transform: Transform;
}

interface State {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  globalAlpha: number;
  clip: Rect[] | null;
  transform: Transform;
}

interface Path {
  points: [number, number][];
  arcs: DrawnShape['arcs'];
  rects: Rect[];
  closed: boolean;
}

const emptyPath = (): Path => ({ points: [], arcs: [], rects: [], closed: false });

const createRecorder = (canvas: HTMLCanvasElement) => {
  const shapes: DrawnShape[] = [];
  let path = emptyPath();
  let state: State = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    clip: null,
    transform: [1, 0, 0, 1, 0, 0],
  };
  const saved: State[] = [];
  const push = (op: DrawnShape['op'], drawnPath: Path) =>
    shapes.push({
      op,
      points: [...drawnPath.points],
      arcs: [...drawnPath.arcs],
      rects: [...drawnPath.rects],
      closed: drawnPath.closed,
      style: op === 'fill' ? state.fillStyle : state.strokeStyle,
      lineWidth: state.lineWidth,
      lineCap: state.lineCap,
      alpha: state.globalAlpha,
      clip: state.clip,
      transform: state.transform,
    });
  const context = {
    canvas,
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    get lineCap() {
      return state.lineCap;
    },
    set lineCap(value: string) {
      state.lineCap = value;
    },
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(value: number) {
      state.globalAlpha = value;
    },
    setTransform: (...transform: Transform) => {
      state.transform = transform;
    },
    save: () => saved.push({ ...state }),
    restore: () => {
      state = saved.pop() ?? state;
    },
    // the whole canvas cleared: nothing drawn
    clearRect: (x: number, y: number, width: number, height: number) => {
      const [a, , , d, e, f] = state.transform;
      const [left, top] = [a * x + e, d * y + f];
      if (left <= 0 && top <= 0 && left + a * width >= canvas.width && top + d * height >= canvas.height)
        shapes.length = 0;
    },
    beginPath: () => {
      path = emptyPath();
    },
    moveTo: (x: number, y: number) => path.points.push([x, y]),
    lineTo: (x: number, y: number) => path.points.push([x, y]),
    closePath: () => {
      path.closed = true;
    },
    arc: (x: number, y: number, radius: number) => path.arcs.push({ x, y, radius }),
    rect: (x: number, y: number, width: number, height: number) => path.rects.push([x, y, width, height]),
    fill: () => push('fill', path),
    stroke: () => push('stroke', path),
    clip: () => {
      state.clip = [...path.rects];
    },
    fillRect: (x: number, y: number, width: number, height: number) =>
      push('fill', { ...emptyPath(), rects: [[x, y, width, height]] }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  return { context, shapes };
};

const recorders = new WeakMap<HTMLCanvasElement, ReturnType<typeof createRecorder>>();

// every canvas gets a recording 2D context (a spec can still spy on getContext)
export const installCanvasStub = () =>
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value(this: HTMLCanvasElement, type: string) {
      if (type !== '2d') return null;
      let recorder = recorders.get(this);
      if (!recorder) recorders.set(this, (recorder = createRecorder(this)));
      return recorder.context;
    },
  });

// what is on a canvas: the shapes drawn since it was last cleared, in their order
export const drawn = (canvas: Element | null): DrawnShape[] =>
  canvas instanceof HTMLCanvasElement ? [...(recorders.get(canvas)?.shapes ?? [])] : [];

// the points of a shape as the d of an SVG path (M0,50L100,0…), as the charts wrote them before their canvases
export const svgPath = ({ points }: Pick<DrawnShape, 'points'>) =>
  points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join('');
