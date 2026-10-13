import React from 'react';
import { render, screen } from '@testing-library/react';
import { PianoKeyboard } from './index';

describe('PianoKeyboard', () => {
  it('labels the C key of every octave', () => {
    const { container } = render(<PianoKeyboard pressed={{}} octaves={[2, 4]} fitScreen={false} />);
    ['C2', 'C3', 'C4'].forEach((label) => expect(screen.getByText(label)).toBeTruthy());
    expect(screen.queryByText('C1')).toBeNull();
    expect(screen.queryByText('C5')).toBeNull();
    expect(container.querySelector('[data-octave="3"][data-note="C"]')?.textContent).toBe('C3');
    expect(container.querySelector('[data-octave="3"][data-note="D"]')?.textContent).toBe('');
  });
});
