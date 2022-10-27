export const thresholds = (value: number, min: number, max: number) => Math.max(Math.min(value, max), min);

export const powerOfTwo = (val: number) => 2 ** val;
