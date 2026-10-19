// a linear scale of a chart as k·v + b: its d3 scale is a chain of calls per point
export interface Affine {
  k: number;
  b: number;
}

const IDENTITY: Affine = { k: 1, b: 0 };

export const affine = (scale: (value: number) => number): Affine => {
  const b = scale(0);
  return { k: scale(1) - b, b };
};

const M = 77;
const L = 76;
const Z = 90;
const COMMA = 44;
const MINUS = 45;
const DOT = 46;
const ZERO = 48;
// the most bytes of a point: M or L, two coordinates of a sign, 9 digits and a tenth, a comma
const POINT_BYTES = 26;

// the text of a path goes as ASCII bytes into one buffer, decoded once: a string built by + per number is several
// times slower (the wave of a chart drawn every frame has ~800 points)
let bytes = new Uint8Array(16384);
let latin1: TextDecoder | null = null;

const decode = (length: number) => {
  if (!latin1) latin1 = new TextDecoder('latin1');
  return latin1.decode(bytes.subarray(0, length));
};

// a coordinate to 0.1 px (12, 12.5, -3.1: as sharp as it is drawn, a shorter path to parse than full doubles)
// written at `at`, its end
const writePx = (at: number, value: number) => {
  let tenths = Math.round(value * 10);
  // not a number or past any screen: 0, not an endless run of digits
  if (!(tenths > -2e9 && tenths < 2e9)) tenths = 0;
  if (tenths < 0) {
    bytes[at++] = MINUS;
    tenths = -tenths;
  }
  const whole = (tenths / 10) | 0;
  const tenth = tenths - whole * 10;
  let end = at;
  for (let rest = whole; rest >= 10; rest = (rest / 10) | 0) end++;
  for (let i = end, rest = whole; i >= at; i--) {
    const next = (rest / 10) | 0;
    bytes[i] = ZERO + rest - next * 10;
    rest = next;
  }
  at = end + 1;
  if (tenth !== 0) {
    bytes[at++] = DOT;
    bytes[at++] = ZERO + tenth;
  }
  return at;
};

// the path of a line through `count` points (xs, ys), mapped by the scales x and y: the charts drawn every frame
// (useLiveDraw) build it without d3
export const linePath = (count: number, xs: Float64Array, ys: Float64Array, x = IDENTITY, y = IDENTITY) => {
  if (bytes.length < count * POINT_BYTES) bytes = new Uint8Array(count * POINT_BYTES * 2);
  const { k: kx, b: bx } = x;
  const { k: ky, b: by } = y;
  let at = 0;
  for (let i = 0; i < count; i++) {
    bytes[at++] = i === 0 ? M : L;
    at = writePx(at, kx * xs[i] + bx);
    bytes[at++] = COMMA;
    at = writePx(at, ky * ys[i] + by);
  }
  return decode(at);
};

// the area between a line (its path, from x0 to x1) and the horizontal line at y0
export const areaPath = (line: string, x0: number, x1: number, y0: number) => {
  if (line === '') return '';
  let at = 0;
  bytes[at++] = L;
  at = writePx(at, x1);
  bytes[at++] = COMMA;
  at = writePx(at, y0);
  bytes[at++] = L;
  at = writePx(at, x0);
  bytes[at++] = COMMA;
  at = writePx(at, y0);
  bytes[at++] = Z;
  return line + decode(at);
};
