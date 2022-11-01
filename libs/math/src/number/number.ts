export const thresholds = (value: number, min: number, max: number) => Math.max(Math.min(value, max), min);

export const getBaseLog = (x: number, y: number) => Math.log(y) / Math.log(x);

export const getLogOfTwo = (val: number) => getBaseLog(2, val);

export const powerOfTwo = (val: number) => 2 ** val;
