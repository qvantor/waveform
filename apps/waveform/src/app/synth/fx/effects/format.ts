export const formatMs = (value: number) => `${Math.round(value * 1000)}ms`;

export const formatHz = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}kHz` : `${Math.round(value)}Hz`;

export const formatSeconds = (value: number) => (value < 1 ? formatMs(value) : `${value.toFixed(1)}s`);
