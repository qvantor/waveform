import { blockStorage, fillStorage } from '../../../../test-utils/storage';
import { setChromium } from '../../../../test-utils/user-agent';
import {
  canChooseLatency,
  canKeepLatency,
  keepNormalLatency,
  readAutoLatency,
  readLatencyMode,
  resolveLatency,
  setLatencyMode,
  switchToNormalLatency,
} from './latency';

const mockReload = () => {
  const reload = jest.fn();
  const { location } = window;
  Object.defineProperty(window, 'location', { configurable: true, value: { ...location, reload } });
  return reload;
};

const location = window.location;
afterEach(() => Object.defineProperty(window, 'location', { configurable: true, value: location }));

describe('canChooseLatency', () => {
  it('is Chromium on a desktop', () => {
    expect(canChooseLatency()).toBe(false);
    setChromium();
    expect(canChooseLatency()).toBe(true);
    setChromium({ mobile: true });
    expect(canChooseLatency()).toBe(false);
  });

  it('is not another engine with userAgentData', () => {
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { brands: [{ brand: 'Other', version: '1' }], mobile: false },
    });
    expect(canChooseLatency()).toBe(false);
  });
});

describe('resolveLatency', () => {
  it('leaves the latency to a browser that ignores the hint', () => {
    setLatencyMode('low');
    expect(resolveLatency()).toBeNull();
  });

  it('auto starts low and stays normal once it learnt it', () => {
    setChromium();
    expect(readLatencyMode()).toBe('auto');
    expect(resolveLatency()).toBe('low');
    keepNormalLatency();
    expect(resolveLatency()).toBe('normal');
  });

  it('auto is normal in a Chromium that counts no dropouts, a low chosen by hand stays', () => {
    setChromium({ countsDropouts: false });
    expect(resolveLatency()).toBe('normal');
    setLatencyMode('low');
    expect(resolveLatency()).toBe('low');
  });

  it('a mode chosen by hand is played whatever auto learnt', () => {
    setChromium();
    keepNormalLatency();
    setLatencyMode('low');
    expect(resolveLatency()).toBe('low');
    setLatencyMode('normal');
    expect(resolveLatency()).toBe('normal');
  });

  it('auto chosen again tries low again', () => {
    setChromium();
    keepNormalLatency();
    setLatencyMode('auto');
    expect(readAutoLatency()).toBe('low');
    expect(resolveLatency()).toBe('low');
  });

  it('ignores a stored value that is not a mode', () => {
    setChromium();
    localStorage.setItem('latencyMode', JSON.stringify('fast'));
    localStorage.setItem('latencyAuto', JSON.stringify(3));
    expect(resolveLatency()).toBe('low');
  });
});

describe('without a storage that keeps the choice', () => {
  it('is normal where site data is blocked: nothing would keep what auto learnt at low', () => {
    setChromium();
    blockStorage('localStorage');
    expect(canKeepLatency()).toBe(false);
    expect(resolveLatency()).toBe('normal');
  });

  it('is normal in a full storage, whatever was chosen', () => {
    setChromium();
    setLatencyMode('low');
    fillStorage();
    expect(resolveLatency()).toBe('normal');
  });
});

describe('switchToNormalLatency', () => {
  it('reloads in auto: it learnt normal already', () => {
    const reload = mockReload();
    keepNormalLatency();
    switchToNormalLatency();
    expect(readLatencyMode()).toBe('auto');
    expect(readAutoLatency()).toBe('normal');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('makes a low chosen by hand normal', () => {
    const reload = mockReload();
    setLatencyMode('low');
    switchToNormalLatency();
    expect(readLatencyMode()).toBe('normal');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
