import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BehaviorSubject } from 'rxjs';
import { useSynthCore } from '../../common/modules';
import type { TableState, WavetableStatus } from '../../common/wavetable/wavetable-engine';
import { OscillatorContext } from '../hooks';
import { OscillatorStatus, oscillatorStatusMessage } from './oscillator-status';

jest.mock('../../common/modules', () => ({
  ...jest.requireActual('../../common/modules'),
  useSynthCore: jest.fn(),
}));

const setup = (status: WavetableStatus, table: TableState | null = null) => {
  const wavetables = { $status: new BehaviorSubject<WavetableStatus>(status), retry: jest.fn() };
  (useSynthCore as jest.Mock).mockReturnValue([{ wavetables }]);
  // the oscillator: the state of its table, its Retry
  const $tableState = new BehaviorSubject<TableState | null>(table);
  const retryTable = jest.fn();
  const oscillator = [{ $tableState }, { retryTable }] as unknown as React.ContextType<
    typeof OscillatorContext
  >;
  render(
    <OscillatorContext.Provider value={oscillator}>
      <OscillatorStatus />
    </OscillatorContext.Provider>
  );
  return { wavetables, $tableState, retryTable, user: userEvent.setup() };
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

  it('a table the store had no memory for: the previous one plays, Retry sends it again', async () => {
    const { $tableState, retryTable, user } = setup('ready', 'sending');
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => $tableState.next('refused'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Not enough memory for the table: the previous one plays'
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryTable).toHaveBeenCalled();
    act(() => $tableState.next('stored'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a table that failed to build: Retry sends it again', async () => {
    const { retryTable, user } = setup('ready', 'failed');
    expect(screen.getByRole('alert')).toHaveTextContent('The table failed to build: the previous one plays');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryTable).toHaveBeenCalled();
  });

  it('the oscillators that cannot play come first: their Retry loads the module', async () => {
    const { wavetables, retryTable, user } = setup('failed', 'refused');
    expect(screen.getByRole('alert')).toHaveTextContent("Oscillators can't play: Failed to load");
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(wavetables.retry).toHaveBeenCalled();
    expect(retryTable).not.toHaveBeenCalled();
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
