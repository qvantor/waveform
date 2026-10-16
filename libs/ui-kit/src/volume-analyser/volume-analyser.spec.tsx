import React from 'react';
import { render } from '@testing-library/react';
import { theme } from '../common/constants';
import { FFT_SIZE, METER } from './meter';
import { VolumeAnalyser } from './index';

const WIDTH = 40;
const HEIGHT = 60;
const GAP = 1;
const COLUMN = (WIDTH - GAP) / 2;
const RIGHT = COLUMN + GAP;

type Signal = (data: Float32Array) => void;

const fromDb = (db: number) => 10 ** (db / 20);
// rms = peak, so the bar and the mark of one frame are at the same level
const square =
  (db: number): Signal =>
  (data) =>
    data.forEach((_, i) => (data[i] = i % 2 ? fromDb(db) : -fromDb(db)));
const silence: Signal = (data) => data.fill(0);

interface Rect {
  style: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
}

const setup = () => {
  const rects: Rect[] = [];
  const gradient = { addColorStop: jest.fn() };
  // jsdom has no canvas: getContext returns a stub that records the drawn rects with their fill
  const ctx = {
    fillStyle: '' as unknown,
    createLinearGradient: () => gradient,
    clearRect: jest.fn(),
    fillRect: (x: number, y: number, w: number, h: number) =>
      rects.push({ style: ctx.fillStyle, x, y, w, h }),
  };
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);

  // keep the scheduled frame to draw it by hand with a timestamp
  let frame: ((time: number) => void) | undefined;
  let frameId = 0;
  const cancelAnimationFrame = jest.fn();
  Object.assign(window, {
    requestAnimationFrame: (callback: (time: number) => void) => {
      frame = callback;
      frameId += 1;
      return frameId;
    },
    cancelAnimationFrame,
  });

  const signals = { L: silence, R: silence };
  const upmix = {
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'discrete',
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
  const splitter = { connect: jest.fn(), disconnect: jest.fn() };
  const analysers: { fftSize: number; getFloatTimeDomainData: jest.Mock }[] = [];
  const audioCtx = {
    createGain: () => upmix,
    createChannelSplitter: () => splitter,
    createAnalyser: () => {
      const channel = analysers.length ? 'R' : 'L';
      const analyser = {
        fftSize: 2048,
        getFloatTimeDomainData: jest.fn((data: Float32Array) => signals[channel](data)),
      };
      analysers.push(analyser);
      return analyser;
    },
  } as unknown as AudioContext;
  const master = { connect: jest.fn(), disconnect: jest.fn() } as unknown as AudioNode;

  const result = render(<VolumeAnalyser audioCtx={audioCtx} master={master} />);

  // draws one frame at time ms, returns the bar and the mark of each column
  const drawFrame = (time: number) => {
    rects.length = 0;
    frame?.(time);
    const column = (x: number) => ({
      bar: rects.find((rect) => rect.x === x && rect.style === gradient),
      mark: rects.find((rect) => rect.x === x && rect.style === theme.colors.thirdAccent),
    });
    return { L: column(0), R: column(RIGHT) };
  };
  return {
    ...result,
    signals,
    upmix,
    splitter,
    analysers,
    master,
    gradient,
    cancelAnimationFrame,
    drawFrame,
  };
};

const original = {
  requestAnimationFrame: window.requestAnimationFrame,
  cancelAnimationFrame: window.cancelAnimationFrame,
};

afterEach(() => {
  jest.restoreAllMocks();
  Object.assign(window, original);
});

describe('VolumeAnalyser', () => {
  // the splitter is discrete: a mono master would reach only the left analyser
  it('upmixes the master to stereo and splits it to the L and R analysers', () => {
    const { master, upmix, splitter, analysers } = setup();
    expect(master.connect).toHaveBeenCalledWith(upmix);
    expect(upmix).toMatchObject({
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    expect(upmix.connect).toHaveBeenCalledWith(splitter);
    expect(splitter.connect.mock.calls).toEqual([
      [analysers[0], 0],
      [analysers[1], 1],
    ]);
    expect(analysers.map(({ fftSize }) => fftSize)).toEqual([FFT_SIZE, FFT_SIZE]);
  });

  it('reads the whole window of each analyser', () => {
    const { analysers, drawFrame } = setup();
    drawFrame(0);
    analysers.forEach(({ getFloatTimeDomainData }) => {
      expect(getFloatTimeDomainData).toHaveBeenCalledTimes(1);
      expect(getFloatTimeDomainData.mock.calls[0][0]).toHaveLength(FFT_SIZE);
    });
  });

  it('draws each channel from its own analyser on the dB scale', () => {
    const { signals, drawFrame } = setup();
    signals.L = square(METER.minDb / 2);
    const { L, R } = drawFrame(0);
    // -24 dB is the middle of the -48..0 dB scale
    expect(L.bar).toMatchObject({ y: HEIGHT, w: COLUMN });
    expect(L.bar?.h).toBeCloseTo(-HEIGHT / 2);
    expect(R.bar?.h).toBeCloseTo(0);
    expect(R.bar?.w).toBe(COLUMN);
    // no peak, no mark
    expect(R.mark).toBeUndefined();
  });

  // the old meter drew the bar at rms × 0.8 height and the mark at rms × height
  it('puts the peak mark on the scale of the bar', () => {
    const { signals, drawFrame } = setup();
    signals.L = square(-24);
    signals.R = square(-6);
    const { L, R } = drawFrame(0);
    [L, R].forEach(({ bar, mark }) => {
      expect(mark?.h).toBe(1);
      expect(mark?.y).toBe(Math.round(HEIGHT + (bar?.h ?? 0)));
    });
  });

  it('keeps the mark at the top for peaks above 0 dBFS', () => {
    const { signals, drawFrame } = setup();
    signals.L = square(3);
    const { L } = drawFrame(0);
    expect(L.bar?.h).toBe(-HEIGHT);
    expect(L.mark?.y).toBe(0);
  });

  it(`holds the peak mark for ${METER.peakHold} s, then it falls ${METER.peakFall} dB/s`, () => {
    const { signals, drawFrame } = setup();
    const markY = (db: number) => Math.round(HEIGHT - ((db - METER.minDb) / -METER.minDb) * HEIGHT);
    signals.L = square(-6);
    expect(drawFrame(0).L.mark?.y).toBe(markY(-6));
    signals.L = square(-30);
    expect(drawFrame(500).L.mark?.y).toBe(markY(-6));
    expect(drawFrame(1000).L.mark?.y).toBe(markY(-6));
    // half a second of the fall
    const { L } = drawFrame(1500);
    expect(L.mark?.y).toBe(markY(-16));
    expect(L.bar?.h).toBeCloseTo(-((-30 - METER.minDb) / -METER.minDb) * HEIGHT);
  });

  it(`colors the bar green below ${METER.warnDb} dB, yellow up to ${METER.hotDb} dB, red above`, () => {
    const { gradient } = setup();
    expect(gradient.addColorStop.mock.calls).toEqual([
      [0, theme.colors.accent],
      [0.75, theme.colors.accent],
      [0.75, theme.colors.thirdAccent],
      [0.9375, theme.colors.thirdAccent],
      [0.9375, theme.colors.red],
      [1, theme.colors.red],
    ]);
  });

  it('cancels the first frame and disconnects from the master when unmounted before drawing', () => {
    const { master, upmix, splitter, cancelAnimationFrame, unmount } = setup();
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(master.disconnect).toHaveBeenCalledWith(upmix);
    expect(upmix.disconnect).toHaveBeenCalled();
    expect(splitter.disconnect).toHaveBeenCalled();
  });

  it('cancels the scheduled frame after drawing', () => {
    const { cancelAnimationFrame, drawFrame, unmount } = setup();
    drawFrame(0);
    drawFrame(16);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(3);
  });
});
