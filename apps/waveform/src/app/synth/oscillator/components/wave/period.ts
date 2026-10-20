// one period of a wave from edge to edge (phase 0 to 360°) as the chart draws it, its period line: a zero, the
// samples, the first sample again at the end, a zero; the zeros outside the chart close the fill along the middle

// the x in the period line of a phase (a share of the period) of a wave of length samples
export const periodX = (phase: number, length: number) => 1 + phase * length;

// the most points of the period line of a wave drawn into `columns` pixels (periodPoints)
export const periodCapacity = (columns: number) => 2 * columns + 3;

// the points of the period line into xs (the x in the line) and ys (the value), their number: every sample while
// there are at most 2 per pixel column, else the lowest and the highest of each column in their order (2048
// samples into 400 px: ~800 points instead of 2051, the same picture); none for no wave
export const periodPoints = (
  wave: ArrayLike<number>,
  columns: number,
  xs: Float64Array,
  ys: Float64Array
) => {
  const { length } = wave;
  if (length === 0) return 0;
  xs[0] = 0;
  ys[0] = 0;
  let count = 1;
  if (length <= 2 * columns) {
    for (let i = 0; i < length; i++) {
      xs[count] = i + 1;
      ys[count++] = wave[i];
    }
  } else {
    // the column of the samples from `low` and `high` on (each has more than 2), the first sample of the next one
    let column = 0;
    let next = Math.ceil(length / columns);
    let low = 0;
    let high = 0;
    for (let i = 1; i <= length; i++) {
      if (i === next || i === length) {
        const first = low < high ? low : high;
        const last = low < high ? high : low;
        xs[count] = first + 1;
        ys[count++] = wave[first];
        if (last !== first) {
          xs[count] = last + 1;
          ys[count++] = wave[last];
        }
        if (i === length) break;
        column++;
        next = Math.ceil(((column + 1) * length) / columns);
        low = high = i;
      } else if (wave[i] < wave[low]) low = i;
      else if (wave[i] > wave[high]) high = i;
    }
  }
  xs[count] = length + 1;
  ys[count++] = wave[0];
  xs[count] = length + 2;
  ys[count++] = 0;
  return count;
};
