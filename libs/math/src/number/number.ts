const thresholds = (value: number, min: number, max: number) => Math.max(Math.min(value, max), min);

const powerOfTwo = (val: number) => 2 ** val;

export const number = { thresholds, powerOfTwo };
