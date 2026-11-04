import { render, screen } from '@testing-library/react';
import { AboutLink, ABOUT_PATH } from './about-link';

describe('AboutLink', () => {
  it('is a link to the English promo page in a new tab, named for screen readers', () => {
    render(<AboutLink />);
    const link = screen.getByRole('link', { name: 'About Chisper' });
    expect(link.getAttribute('href')).toBe('/wavetable-synth/');
    expect(ABOUT_PATH).toBe('/wavetable-synth/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(link.querySelector('svg')).toBeTruthy();
  });
});
