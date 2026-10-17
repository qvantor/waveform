import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BehaviorSubject } from 'rxjs';
import { useSynthCore } from '../../common/modules';
import type { WavetableStatus } from '../../common/wavetable/wavetable-engine';
import { OscillatorStatus, oscillatorStatusMessage } from './oscillator-status';

jest.mock('../../common/modules', () => ({
  ...jest.requireActual('../../common/modules'),
  useSynthCore: jest.fn(),
}));

const setup = (status: WavetableStatus) => {
  const wavetables = { $status: new BehaviorSubject<WavetableStatus>(status), retry: jest.fn() };
  (useSynthCore as jest.Mock).mockReturnValue([{ wavetables }]);
  render(<OscillatorStatus />);
  return { wavetables, user: userEvent.setup() };
};

describe('OscillatorStatus', () => {
  it('shows nothing while the oscillators load or play', () => {
    const { wavetables } = setup('loading');
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => wavetables.$status.next('ready'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells why they are not supported, without Retry', () => {
    setup('unsupported');
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Oscillators can't play: Not supported by this browser"
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('asks for HTTPS outside a secure context', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => false });
    expect(oscillatorStatusMessage('unsupported')).toBe('Needs HTTPS or localhost');
  });

  it('a failed module: Retry loads it again', async () => {
    const { wavetables, user } = setup('failed');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(wavetables.retry).toHaveBeenCalled();
    act(() => wavetables.$status.next('ready'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
