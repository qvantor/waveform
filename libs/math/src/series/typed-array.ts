export const slice = (array: Float32Array, from: number, count: number) => {
  const slice = [];
  for (let i = from; i < from + count; i++) slice.push(array[i]);
  return slice;
};
