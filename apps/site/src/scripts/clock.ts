// m:ss of a time in seconds (rounded down: a clip of 16.7 s ends at 0:16)
export const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
