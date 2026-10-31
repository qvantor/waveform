import { number } from '@waveform/math';

// the scale of the meter in dBFS: green below warnDb, yellow up to hotDb, red above it. The master limiter
// keeps the peaks at -0.5 dBFS, the top of the scale, so a peak mark at the top means it is limiting.
// The peak mark holds the highest peak for peakHold s, then falls peakFall dB/s
export const METER = { minDb: -48, warnDb: -12, hotDb: -3, peakHold: 1, peakFall: 20 };

// ~85 ms at 48 kHz: a few periods of a bass note (the rms doesn't flicker) and longer than a frame,
// so no peak is missed between two frames. The window is only the copy of the main thread: an analyser of Chromium
// writes the same quantum into a ring of its own at any fftSize (1024 cost the main thread no less)
export const FFT_SIZE = 4096;

export const levels = (data: Float32Array) => {
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return { rms: data.length ? Math.sqrt(sumSquares / data.length) : 0, peak };
};

export const toDb = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

// silence and everything below minDb is 0, 0 dBFS and above is the full height
export const dbToHeight = (db: number, height: number) =>
  Number.isNaN(db) ? 0 : number.thresholds((db - METER.minDb) / -METER.minDb, 0, 1) * height;

// the peak mark of one channel: rises at once, holds, then falls; once it has fallen to the current peak,
// that one is held. time is in seconds (the frame timestamp), not frames: their rate varies
export const createPeakHold = () => {
  let held = -Infinity;
  let heldAt = -Infinity;
  let lastTime = -Infinity;
  return (db: number, time: number) => {
    const fallFrom = Math.max(lastTime, heldAt + METER.peakHold);
    const fallen = time > fallFrom ? held - METER.peakFall * (time - fallFrom) : held;
    if (db >= fallen) {
      held = db;
      heldAt = time;
    } else held = fallen;
    lastTime = time;
    return held;
  };
};

// the color bands of the bar, as [offset from the bottom 0..1, zone] pairs for a vertical gradient
export const zoneStops = (): [number, 'normal' | 'warn' | 'hot'][] => {
  const warn = dbToHeight(METER.warnDb, 1);
  const hot = dbToHeight(METER.hotDb, 1);
  return [
    [0, 'normal'],
    [warn, 'normal'],
    [warn, 'warn'],
    [hot, 'warn'],
    [hot, 'hot'],
    [1, 'hot'],
  ];
};
