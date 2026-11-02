import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createTransport } from '../../../test-utils/models';
import { TransportContext } from '../common/modules/transport';
import { Tempo } from './tempo';

const setup = () => {
  const transport = createTransport();
  render(
    <TransportContext.Provider value={transport}>
      <Tempo />
    </TransportContext.Provider>
  );
  return transport;
};

describe('Tempo', () => {
  it('sets the tempo of the field', () => {
    const [model] = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    expect(model.$bpm.value).toBe(121);
    expect(screen.getByRole('slider', { name: 'Tempo' }).textContent).toBe('121BPM');
    expect(localStorage.getItem('tempo')).toBe('121');
  });

  it('shows the tempo of a MIDI Clock as EXT, only shown', () => {
    const [model, actions] = setup();
    act(() => {
      actions.setSource('midi');
      actions.follow({ time: 0, beat: 0, bpm: 127.996 });
    });
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText('128')).toBeTruthy();
    expect(screen.getByText('EXT')).toBeTruthy();
    expect(model.$bpm.value).toBe(120);
  });
});
