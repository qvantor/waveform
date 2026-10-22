import { act, fireEvent, render, screen } from '@testing-library/react';
import toast from 'react-hot-toast';
import { BehaviorSubject } from 'rxjs';
import type { FxStatus } from '../../fx/effects/types';
import { LimiterStatus } from './limiter-status';

const mockStatus = new BehaviorSubject<FxStatus>('loading');
const mockRetryAudio = jest.fn();

jest.mock('../../common/modules', () => ({
  useSynthCore: () => [{ masterLimiter: { $status: mockStatus } }, { retryAudio: mockRetryAudio }],
}));

beforeEach(() => mockStatus.next('loading'));

describe('LimiterStatus', () => {
  it('shows nothing while the limiter loads, plays or is unsupported (the oscillators tell why)', () => {
    render(<LimiterStatus />);
    act(() => mockStatus.next('ready'));
    act(() => mockStatus.next('unsupported'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  // react-hot-toast is mocked: its content rendered by the spec
  it('a failed limiter: a toast until it loads again, its Retry loads the oscillators and the limiter', () => {
    render(<LimiterStatus />);
    act(() => mockStatus.next('failed'));
    const [[content, options]] = jest.mocked(toast.error).mock.calls;
    expect(options).toEqual({ id: 'limiter-failed', duration: Infinity });
    render(content as JSX.Element);
    expect(screen.getByText('No sound: the master limiter failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRetryAudio).toHaveBeenCalledTimes(1);
    expect(toast.dismiss).not.toHaveBeenCalled();
    act(() => mockStatus.next('loading'));
    expect(toast.dismiss).toHaveBeenCalledWith('limiter-failed');
  });

  it('takes the toast away when it unmounts', () => {
    const { unmount } = render(<LimiterStatus />);
    act(() => mockStatus.next('failed'));
    unmount();
    expect(toast.dismiss).toHaveBeenCalledWith('limiter-failed');
  });
});
