import { render, screen } from '@testing-library/react';
import { REVERB_ERAS } from '../../effects/reverb-era';
import { GUIDES } from './mode-icon';
import { eraCurve, ERA_ICONS } from './reverb-era-icons';

const [TOP] = GUIDES;
const [now, eighties, seventies] = REVERB_ERAS.map((era) => eraCurve(era));
const ys = (curve: [number, number][]) => curve.map(([, y]) => y);
// the first x where the line has gone down by half of the way to the floor
const kneeOf = (curve: [number, number][]) => curve.find(([, y]) => y > TOP + 7)?.[0];

describe('era icons', () => {
  it('draws one across the frame for every era', () => {
    REVERB_ERAS.forEach((era) => {
      render(<div>{ERA_ICONS[era.id]}</div>);
      const icon = screen.getByTestId(`reverb-era-${era.id}`);
      expect(icon).toHaveAttribute('viewBox', '0 0 56 24');
      expect(icon.querySelectorAll('line')).toHaveLength(GUIDES.length);
      expect(icon.querySelector('polyline')).toBeInTheDocument();
    });
    [now, eighties, seventies].forEach((curve) => {
      expect(curve[0][0]).toBe(2);
      expect(curve[curve.length - 1][0]).toBe(54);
    });
  });

  it('now is flat on the 0 dB guide', () => {
    expect(new Set(ys(now))).toEqual(new Set([TOP]));
  });

  it('the older era bends down earlier, the body bumps above the 0 dB guide', () => {
    expect(kneeOf(seventies)).toBeLessThan(kneeOf(eighties) ?? 0);
    expect(eighties[eighties.length - 1][1]).toBe(22);
    expect(seventies[seventies.length - 1][1]).toBe(22);
    expect(Math.min(...ys(eighties))).toBeLessThan(TOP);
    expect(Math.min(...ys(seventies))).toBeLessThan(Math.min(...ys(eighties)));
    // never rises again once it goes down
    [eighties, seventies].forEach((curve) =>
      curve.slice(20).forEach(([, y], i) => expect(y).toBeGreaterThanOrEqual(curve[19 + i][1]))
    );
  });
});
