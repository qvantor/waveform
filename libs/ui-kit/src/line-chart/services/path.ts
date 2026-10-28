// a linear scale of a chart as k·v + b: its d3 scale is a chain of calls per point
export interface Affine {
  k: number;
  b: number;
}

export const IDENTITY: Affine = { k: 1, b: 0 };

export const affine = (scale: (value: number) => number): Affine => {
  const b = scale(0);
  return { k: scale(1) - b, b };
};
