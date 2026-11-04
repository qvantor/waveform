import { render, screen } from '@testing-library/react';
import { DISTORTION_MODES } from '../../effects/distortion-modes';
import { DISTORTION_MODE_ICONS, modeCurve } from './distortion-mode-icons';
import { GUIDES } from './mode-icon';

const [TOP, BOTTOM] = GUIDES;
const [soft, hard] = DISTORTION_MODES.map((mode) => modeCurve(mode));
const ys = (curve: [number, number][]) => curve.map(([, y]) => y);

describe('distortion mode icons', () => {
  it('draws one in the mode switch frame for every mode', () => {
    DISTORTION_MODES.forEach((mode) => {
      render(<div>{DISTORTION_MODE_ICONS[mode.id]}</div>);
      const icon = screen.getByTestId(`distortion-mode-${mode.id}`);
      expect(icon).toHaveAttribute('viewBox', '0 0 56 24');
      expect(icon.querySelectorAll('line')).toHaveLength(GUIDES.length);
      expect(icon.querySelector('polyline')).toBeInTheDocument();
    });
  });

  it('the curves rise from the bottom guide to the top one, through the middle', () => {
    [soft, hard].forEach((curve) => {
      const values = ys(curve);
      expect(Math.max(...values)).toBeLessThanOrEqual(BOTTOM);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(TOP);
      expect(values[(values.length - 1) / 2]).toBe((TOP + BOTTOM) / 2);
      values.slice(1).forEach((y, i) => expect(y).toBeLessThanOrEqual(values[i]));
    });
  });

  it('hard clip sits flat on the guides, soft clip only comes near them', () => {
    expect(ys(hard)[0]).toBe(BOTTOM);
    expect(ys(hard).filter((y) => y === TOP).length).toBeGreaterThan(5);
    expect(ys(soft).filter((y) => y === TOP)).toHaveLength(0);
    expect(Math.min(...ys(soft))).toBeLessThan(TOP + 0.2);
  });
});
