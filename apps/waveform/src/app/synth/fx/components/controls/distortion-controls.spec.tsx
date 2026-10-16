import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FX_PARAMS } from '@waveform/preset-schema';
import { mapValues } from 'lodash';
import { distortion } from '../../effects/distortion';
import { DistortionControls } from './distortion-controls';

const params = mapValues(FX_PARAMS.distortion, (param) => param.default);

// the chart draws once it knows its size
const OriginalResizeObserver = window.ResizeObserver;
beforeAll(() => {
  window.ResizeObserver = class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() {
      this.callback([{ contentRect: { width: 160, height: 80 } } as ResizeObserverEntry], this as never);
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  window.ResizeObserver = OriginalResizeObserver;
});

const setup = (props: Partial<React.ComponentProps<typeof DistortionControls>> = {}) => {
  const setParam = jest.fn();
  const user = userEvent.setup();
  const result = render(
    <DistortionControls params={params} setParam={setParam} on sampleRate={48000} {...props} />
  );
  const rerender = (changes: Partial<typeof params>, on = true) =>
    result.rerender(
      <DistortionControls params={{ ...params, ...changes }} setParam={setParam} on={on} sampleRate={48000} />
    );
  return { ...result, rerender, setParam, user };
};

describe('DistortionControls', () => {
  it('puts the mode first, then drive with its curve, then tone and level', () => {
    setup();
    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Mode', 'Drive', 'Post']);
    const [, drive, post] = groups;
    const chart = within(drive).getByTestId('distortion-curve');
    // the caption, then the knob label
    const [, knob] = within(drive).getAllByText('Drive');
    expect(chart.compareDocumentPosition(knob)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const tone = within(post).getByText('Tone');
    expect(tone.compareDocumentPosition(within(post).getByText('Level'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('puts the out group after the last one', () => {
    render(
      <DistortionControls
        params={params}
        setParam={jest.fn()}
        on
        sampleRate={48000}
        out={<div role='group' aria-label='Out' />}
      />
    );
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      'Mode',
      'Drive',
      'Post',
      'Out',
    ]);
  });

  it('starts on soft clip and shows the current mode with its icon', () => {
    const { rerender } = setup();
    const mode = screen.getByRole('group', { name: 'Mode' });
    const shows = (label: string, id: string) => {
      expect(within(mode).getByRole('button', { name: label })).toBeInTheDocument();
      expect(
        within(mode)
          .getAllByTestId(/^distortion-mode-/)
          .map((icon) => icon.dataset['testid'])
      ).toEqual([`distortion-mode-${id}`]);
    };
    shows('Soft clip', 'soft');
    rerender({ mode: 1 });
    shows('Hard clip', 'hard');
  });

  it('steps the mode by index and wraps around', async () => {
    const { user, setParam, rerender } = setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(setParam).toHaveBeenLastCalledWith('mode', 1);
    rerender({ mode: 1 });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(setParam).toHaveBeenLastCalledWith('mode', 0);
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(setParam).toHaveBeenLastCalledWith('mode', 0);
  });

  it('the curve follows the mode and the drive, the level only scales the output and leaves it', () => {
    const { rerender } = setup();
    const path = () =>
      Array.from(screen.getByTestId('distortion-curve').querySelectorAll('path')).map((item) =>
        item.getAttribute('d')
      );
    const soft = path();
    rerender({ mode: 1 });
    const hard = path();
    rerender({ mode: 1, drive: 18 });
    const harder = path();
    // the dry diagonal stays
    expect(new Set([soft[0], hard[0], harder[0]]).size).toBe(1);
    expect(new Set([soft[1], hard[1], harder[1]]).size).toBe(3);
    [-24, 12].forEach((level) => {
      rerender({ mode: 1, drive: 18, level });
      expect(path()).toEqual(harder);
    });
  });

  it('the curve spans the whole width of the chart and stays inside it', () => {
    setup({ params: { ...params, mode: 1, drive: 18 } });
    const [, curve] = Array.from(screen.getByTestId('distortion-curve').querySelectorAll('path'));
    const points = (curve.getAttribute('d') ?? '').match(/-?[\d.]+,-?[\d.]+/g) ?? [];
    const xs = points.map((point) => Number(point.split(',')[0]));
    const ys = points.map((point) => Number(point.split(',')[1]));
    // the stubbed chart is 160×80, 1px of padding above and below
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(160);
    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThan(78);
  });

  it('greys out the groups and the curve, disables the mode switch while bypassed', () => {
    const { rerender } = setup();
    expect(screen.queryByTestId('distortion-curve-deactivated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    rerender({}, false);
    expect(screen.getByTestId('distortion-curve-deactivated')).toBeInTheDocument();
    screen.getAllByRole('group').forEach((group) => expect(group).toHaveClass('disabled'));
    for (const name of ['Soft clip', 'Previous', 'Next'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('has a mode switch and 3 knobs', () => {
    expect(Object.keys(distortion.params)).toEqual(['mode', 'drive', 'tone', 'level']);
    expect(distortion.params.mode.options?.map(({ label }) => label)).toEqual(['Soft clip', 'Hard clip']);
    expect(Object.values(distortion.params).filter((def) => !def.options && !def.control)).toHaveLength(3);
    // the level fills from 0 dB, the tone knob is log
    expect(distortion.params.level.fillFrom).toBe(0);
    expect(distortion.params.tone.mode).toBe('log');
  });
});
