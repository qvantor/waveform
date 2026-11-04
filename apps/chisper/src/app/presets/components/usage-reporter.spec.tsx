import { act, fireEvent, render, screen } from '@testing-library/react';
import { sendUsage } from '../services';
import { UsageEvent } from '../hooks/use-preset-usage-tracker';
import { CAPTCHA_TIMEOUT_MS, UsageReporter } from './usage-reporter';

let mockReport: (usage: UsageEvent) => void = () => undefined;
jest.mock('../hooks/use-preset-usage-tracker', () => ({
  usePresetUsageTracker: (report: (usage: UsageEvent) => void) => {
    mockReport = report;
  },
}));
jest.mock('../services', () => ({
  ...jest.requireActual('../services'),
  sendUsage: jest.fn(() => Promise.resolve()),
}));

const sendUsageMock = jest.mocked(sendUsage);

const report = (presetId: string, event: UsageEvent['event']) => act(() => mockReport({ presetId, event }));
const captcha = () => screen.queryByRole('button', { name: 'Pass captcha' });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('UsageReporter', () => {
  it('loads no captcha until a listen or a stay is reached', () => {
    render(<UsageReporter />);
    expect(captcha()).not.toBeInTheDocument();
    expect(sendUsageMock).not.toHaveBeenCalled();
  });

  it('sends a listen with the token of a captcha passed for it, then removes the captcha', () => {
    render(<UsageReporter />);
    report('p1', 'listen');
    expect(sendUsageMock).not.toHaveBeenCalled();

    click('Pass captcha');
    expect(sendUsageMock).toHaveBeenCalledWith({
      presetId: 'p1',
      event: 'listen',
      turnstileToken: 'captcha-token',
    });
    expect(captcha()).not.toBeInTheDocument();
  });

  it('sends the events one after another, each with a new captcha', () => {
    render(<UsageReporter />);
    report('p1', 'listen');
    report('p1', 'stay');
    report('p2', 'listen');
    const first = captcha();
    click('Pass captcha');
    const second = captcha();
    expect(second).toBeInTheDocument();
    expect(second).not.toBe(first);
    click('Pass captcha');
    click('Pass captcha');
    expect(captcha()).not.toBeInTheDocument();
    expect(sendUsageMock.mock.calls.map(([{ presetId, event }]) => `${presetId} ${event}`)).toEqual([
      'p1 listen',
      'p1 stay',
      'p2 listen',
    ]);
  });

  it.each([
    ['the captcha fails', 'Fail captcha'],
    ['Cloudflare asks the visitor to interact', 'Ask to interact'],
    ['the browser is not supported', 'Unsupported captcha'],
  ])('drops the event when %s, the next one gets a new captcha', (_, button) => {
    render(<UsageReporter />);
    report('p1', 'listen');
    report('p1', 'stay');
    const first = captcha();
    click(button);
    expect(captcha()).not.toBe(first);
    click('Pass captcha');
    expect(captcha()).not.toBeInTheDocument();
    expect(sendUsageMock.mock.calls).toEqual([
      [{ presetId: 'p1', event: 'stay', turnstileToken: 'captcha-token' }],
    ]);

    report('p2', 'listen');
    click(button);
    expect(captcha()).not.toBeInTheDocument();
    expect(sendUsageMock).toHaveBeenCalledTimes(1);
  });

  describe('without a token in time', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const tick = (ms: number) =>
      act(() => {
        jest.advanceTimersByTime(ms);
      });

    it('drops the event when the captcha gives no token in 30 seconds, as when its script does not load', () => {
      render(<UsageReporter />);
      report('p1', 'listen');
      tick(CAPTCHA_TIMEOUT_MS - 1000);
      report('p1', 'stay');
      const first = captcha();
      tick(1000);
      const second = captcha();
      expect(second).toBeInTheDocument();
      expect(second).not.toBe(first);

      // the next one has its own 30 seconds
      tick(CAPTCHA_TIMEOUT_MS - 1000);
      click('Pass captcha');
      expect(sendUsageMock.mock.calls).toEqual([
        [{ presetId: 'p1', event: 'stay', turnstileToken: 'captcha-token' }],
      ]);
      expect(captcha()).not.toBeInTheDocument();
      tick(CAPTCHA_TIMEOUT_MS);
      expect(sendUsageMock).toHaveBeenCalledTimes(1);
    });
  });

  it('ignores failed requests', async () => {
    sendUsageMock.mockRejectedValueOnce(new Error('offline'));
    render(<UsageReporter />);
    report('p1', 'stay');
    click('Pass captcha');
    await act(() => Promise.resolve());
    expect(captcha()).not.toBeInTheDocument();

    report('p2', 'stay');
    click('Pass captcha');
    expect(sendUsageMock).toHaveBeenCalledTimes(2);
  });
});
