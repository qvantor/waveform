import { fireEvent, render, screen } from '@testing-library/react';
import { withElementSize } from '@chisper/ui-kit/test-utils';
import { InputControllerProvider } from '../common/modules';
import { KeysView } from './keys-view';

// the mini synth, the mini fx and the wheel read the other models: not what these specs are about
jest.mock('./synth-sections', () => ({ SynthSections: () => null }));
jest.mock('../fx', () => ({ FxScreen: () => null }));
jest.mock('../pitch-bend', () => ({ PitchBend: () => null }));

let restoreSize: () => unknown = () => undefined;
afterEach(() => restoreSize());

const setup = (portrait: boolean) => {
  restoreSize = withElementSize(400, 100);
  const { container } = render(
    <InputControllerProvider initial={{}}>
      <KeysView portrait={portrait} screen='osc' />
    </InputControllerProvider>
  );
  // the octaves of the keys of both tiers, by the labels of their C
  const octaves = () => [...container.querySelectorAll('[data-note="C"]')].map((key) => key.textContent);
  const ups = () => screen.getAllByRole('button', { name: 'Octave up' });
  const downs = () => screen.getAllByRole('button', { name: 'Octave down' });
  return { octaves, ups, downs };
};

const stored = () => JSON.parse(localStorage.getItem('mobileKeyboardOctaves') ?? 'null');

describe('KeysView', () => {
  it('in portrait an octave a tier: ▲ and ▼ shift its keys, the browser keeps them', () => {
    const { octaves, ups, downs } = setup(true);
    expect(octaves()).toEqual(['C4', 'C3']);
    // the octave of each tier on its plate
    expect(screen.getAllByRole('group').map((plate) => plate.textContent)).toEqual(['C4', 'C3']);
    fireEvent.click(ups()[0]);
    fireEvent.click(downs()[1]);
    expect(octaves()).toEqual(['C5', 'C2']);
    expect(stored()).toEqual([5, 2]);
  });

  it('in landscape two octaves a tier: a stored octave past the last start plays from there, ▲ off', () => {
    localStorage.setItem('mobileKeyboardOctaves', '[8, 3]');
    const { octaves, ups } = setup(false);
    expect(octaves()).toEqual(['C7', 'C8', 'C3', 'C4']);
    expect(ups()[0]).toBeDisabled();
    expect(ups()[1]).toBeEnabled();
    fireEvent.click(ups()[1]);
    expect(octaves()).toEqual(['C7', 'C8', 'C4', 'C5']);
  });
});
