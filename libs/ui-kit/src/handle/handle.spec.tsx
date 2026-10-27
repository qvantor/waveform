import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { drawn } from '../common/test-utils/canvas';
import { valueScale } from '../common/utils';
import { Handle } from './index';

// size m: the knob's radius is 17, the ring of its travel and the arc of a modulation on it are 6 px wide; a
// knob that takes no modulations has an arc of its travel from 19 to 21 px instead
const RADIUS = 17;
const TRACK_WIDTH = 6;
const ARC_OUTER = 21;
// the angle of the whole travel either way from the top
const MAX_ANGLE = Math.PI / 1.2;

const arcPaths = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('svg path')).map((path) => path.getAttribute('d') ?? '');

// the first point of an arc path, d3 starts it at the start angle on the outer radius
const startPoint = (d: string) => {
  const [x, y] = (d.match(/^M([^,]+),([^A]+)/) ?? []).slice(1).map(Number);
  return { x, y };
};

// the rotation of an element in radians
const rotation = (element: HTMLElement) =>
  Number(element.style.transform.match(/rotate\(([-\d.e]+)rad\)/)?.[1]);

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and
// the document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

// the text of the tooltip of the value, empty while the knob isn't held
const tooltip = () => document.getElementById('tooltip')?.textContent ?? '';

describe('Handle', () => {
  it('that takes no modulations has an arc of its travel around it, under the shadow of the knob, no ring', () => {
    const { container } = render(<Handle min={-1} max={1} value={-1} />);
    expect(screen.queryByTestId('knob-track')).toBeNull();
    // from min, 2 px out of the knob
    const start = startPoint(screen.getByTestId('knob-scale').getAttribute('d') ?? '');
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(ARC_OUTER);
    expect(Math.atan2(start.x, -start.y)).toBeCloseTo(-MAX_ANGLE);
    expect(container.querySelector('svg')?.classList.contains('scale')).toBe(true);
  });

  it('that takes no modulations fills its arc from fillFrom (min by default) to the value, none at it', () => {
    const fill = () => screen.queryByTestId('knob-fill');
    const { rerender } = render(<Handle min={-1} max={1} value={0} />);
    expect(fill()?.getAttribute('fill')).toBe('#2ecc71');
    expect(startPoint(fill()?.getAttribute('d') ?? '')).toEqual(
      startPoint(screen.getByTestId('knob-scale').getAttribute('d') ?? '')
    );
    rerender(<Handle min={-1} max={1} value={-1} />);
    expect(fill()).toBeNull();
    rerender(<Handle min={-1} max={1} value={0} fillFrom={0} />);
    expect(fill()).toBeNull();
    // either way from fillFrom 0 at the top
    for (const value of [0.5, -0.5]) {
      rerender(<Handle min={-1} max={1} value={value} fillFrom={0} />);
      const { x, y } = startPoint(fill()?.getAttribute('d') ?? '');
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(-ARC_OUTER);
    }
    // a knob that takes modulations has none
    rerender(<Handle min={-1} max={1} value={-0.5} fillFrom={0} modulations={[]} />);
    expect(fill()).toBeNull();
  });

  it.each([
    ['m', 2, 34, 13],
    ['l', 3, 44, 17.5],
  ] as const)(
    'of size %s has a round mark of %s px at its edge, so has its live mark (on a canvas of the knob)',
    (size, diameter, box, radius) => {
      const live = { id: 'env2', color: '#fff', amount: 0, level: () => 1, live: true };
      const { container } = render(<Handle min={-1} max={1} value={0} size={size} modulations={[live]} />);
      const style = window.getComputedStyle(
        container.querySelector('[style*="rotate"] > div > div') as Element
      );
      expect([style.width, style.height, style.borderRadius]).toEqual([
        `${diameter}px`,
        `${diameter}px`,
        '100%',
      ]);
      const mark = screen.getByTestId('mod-mark') as HTMLCanvasElement;
      expect([mark.width, mark.height]).toEqual([box, box]);
      const [dot] = drawn(mark);
      // at the top: the knob at its middle, the routes don't move it
      expect(dot.arcs).toEqual([{ x: box / 2, y: box / 2 - radius, radius: diameter / 2 }]);
      expect([dot.op, dot.alpha]).toEqual(['fill', 0.5]);
    }
  );

  it('while held shows the full name of what it changes before the value, a string label by default', () => {
    const format = (value: number) => `${value}%`;
    const { container, rerender } = render(
      <Handle value={35} label='ER' name='Early reflections' formatValue={format} />
    );
    const knob = container.firstElementChild as Element;
    expect(tooltip()).toBe('');
    pointer('pointerdown', knob);
    expect(tooltip()).toBe('Early reflections35%');
    pointer('pointerup', document);
    expect(tooltip()).toBe('');
    rerender(<Handle value={35} label='ER' formatValue={format} />);
    pointer('pointerdown', knob);
    expect(tooltip()).toBe('ER35%');
    pointer('pointerup', document);
    // no name without a string label: only the value
    rerender(<Handle value={35} label={null} formatValue={format} />);
    pointer('pointerdown', knob);
    expect(tooltip()).toBe('35%');
    pointer('pointerup', document);
  });

  it('that takes modulations shows its travel on its edge under the arc of the selected route, no fill', () => {
    const { container, rerender } = render(
      <Handle min={-1} max={1} value={0.5} fillFrom={0} modulations={[]} />
    );
    expect(arcPaths(container)).toHaveLength(1);
    expect(screen.queryByTestId('knob-scale')).toBeNull();
    expect(container.querySelector('svg')?.classList.contains('scale')).toBe(false);
    const track = () => screen.getByTestId('knob-track');
    // from min, on the outer radius of the ring on the edge of the knob
    const start = startPoint(track().getAttribute('d') ?? '');
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(RADIUS + TRACK_WIDTH);
    expect(Math.atan2(start.x, -start.y)).toBeCloseTo(-MAX_ANGLE);
    expect(Number(track().getAttribute('fill-opacity'))).toBeLessThan(1);
    rerender(
      <Handle
        min={-1}
        max={1}
        value={0.5}
        modulations={[{ id: 'env2', color: '#f1c40f', amount: 0.25, selected: true }]}
      />
    );
    // drawn first: the arcs lie on it
    const [first, arc] = Array.from(container.querySelectorAll('svg path'));
    expect(first).toBe(track());
    expect(arc.getAttribute('data-testid')).toBe('mod-arc');
  });
});

describe('Handle scales', () => {
  // the angle of the value from the start of the arc, as a share of its whole travel
  const share = (props: React.ComponentProps<typeof Handle>) => {
    const { container } = render(<Handle {...props} />);
    const angle = rotation(container.querySelector('[style*="rotate"]') as HTMLElement);
    return (angle + MAX_ANGLE) / (2 * MAX_ANGLE);
  };

  it('pow gives the short times most of the travel: of 32 s, 125 ms at a quarter, 2 s in the middle', () => {
    expect(share({ min: 0, max: 32, mode: 'pow', value: 0 })).toBeCloseTo(0);
    expect(share({ min: 0, max: 32, mode: 'pow', value: 0.125 })).toBeCloseTo(0.25);
    expect(share({ min: 0, max: 32, mode: 'pow', value: 2 })).toBeCloseTo(0.5);
    expect(share({ min: 0, max: 32, mode: 'pow', value: 32 })).toBeCloseTo(1);
  });

  it('linear and log as before', () => {
    expect(share({ min: 0, max: 32, value: 8 })).toBeCloseTo(0.25);
    expect(share({ min: 10, max: 1000, mode: 'log', value: 100 })).toBeCloseTo(0.5);
  });
});

describe('valueScale', () => {
  it('pow goes from a time to the travel and back', () => {
    const scale = valueScale('pow').domain([0, 32]).range([-100, 100]);
    [0, 0.0001, 0.005, 0.1, 1, 2.5, 31.9999, 32].forEach((time) =>
      expect(scale.invert(scale(time))).toBeCloseTo(time, 9)
    );
  });
});

describe('Handle modulation', () => {
  const modulation = (amount: number, id = 'env2', selected = true) => ({
    id,
    color: '#f1c40f',
    amount,
    label: id,
    selected,
  });
  // the start and the end angle of an arc path of d3 (it starts at its start angle on the outer radius)
  const angleOf = ({ x, y }: { x: number; y: number }) => Math.atan2(x, -y);
  const modArcs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-testid="mod-arc"]'));
  const sectionColors = () =>
    Array.from(document.querySelectorAll('[data-testid="amount-dot-section"]')).map((path) =>
      path.getAttribute('fill')
    );

  it('draws an arc of the color of the source from the value to the value + amount', () => {
    const { container } = render(<Handle min={0} max={1} value={0.5} modulations={[modulation(0.25)]} />);
    const [path] = modArcs(container);
    expect(path.getAttribute('fill')).toBe('#f1c40f');
    // from the top (0.5) a quarter of the travel clockwise
    const start = startPoint(path.getAttribute('d') ?? '');
    expect(angleOf(start)).toBeCloseTo(0);
  });

  it('shows the arc of the selected route over the whole ring, a dot of all the routes that changes it', () => {
    const { container, rerender } = render(
      <Handle
        min={0}
        max={1}
        value={0.5}
        modulations={[
          { ...modulation(-0.25, 'env1', false), color: '#2ecc71' },
          modulation(0.25, 'env3'),
          { ...modulation(0.5, 'env2', false), color: '#e74c3c' },
        ]}
      />
    );
    const [path] = modArcs(container);
    expect(modArcs(container)).toHaveLength(1);
    const start = startPoint(path.getAttribute('d') ?? '');
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(RADIUS + TRACK_WIDTH);
    expect(screen.getAllByTestId('amount-dot')).toHaveLength(1);
    // a section of each route, in their order
    expect(sectionColors()).toEqual(['#2ecc71', '#f1c40f', '#e74c3c']);
    // its center on the diagonal to the top left, on the outer edge of the ring (14 px, 1 px into it)
    const dot = screen.getByRole('slider', { name: 'env3' });
    const fromCenter = 25 - parseFloat(dot.style.left);
    expect(parseFloat(dot.style.top)).toBe(parseFloat(dot.style.left));
    expect(fromCenter * Math.SQRT2).toBeCloseTo(RADIUS + TRACK_WIDTH + 7 - 1);
    // the selected source has no route on the knob: no arc, the dot only shows the routes
    rerender(
      <Handle
        min={0}
        max={1}
        value={0.5}
        modulations={[modulation(0.25, 'env1', false), modulation(0.5, 'env2', false)]}
      />
    );
    expect(modArcs(container)).toHaveLength(0);
    expect(screen.queryByRole('slider', { name: /env/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'env1, env2' }).getAttribute('data-testid')).toBe('amount-dot');
    expect(sectionColors()).toHaveLength(2);
    // no routes: no dot
    rerender(<Handle min={0} max={1} value={0.5} modulations={[]} />);
    expect(screen.queryByTestId('amount-dot')).toBeNull();
  });

  it('draws the arc of a bipolar route around the value: ±amount / 2', () => {
    const { container } = render(
      <Handle min={0} max={1} value={0.5} modulations={[{ ...modulation(0.5), bipolar: true }]} />
    );
    const [path] = modArcs(container);
    // from a quarter of the travel down to a quarter up
    expect(angleOf(startPoint(path.getAttribute('d') ?? ''))).toBeCloseTo(-MAX_ANGLE / 2);
  });

  it('switches the polarity of the selected route on Shift+Alt+click, turns nothing then', () => {
    const onPolarity = jest.fn();
    const onChange = jest.fn();
    render(
      <Handle
        min={0}
        max={1}
        value={0.5}
        label='Wave'
        onChange={onChange}
        modulations={[{ ...modulation(0.5), onPolarity }]}
      />
    );
    const knob = screen.getByText('Wave').parentElement as HTMLElement;
    const event = new MouseEvent('pointerdown', { bubbles: true, shiftKey: true, altKey: true, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    act(() => {
      knob.dispatchEvent(event);
    });
    expect(onPolarity).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clamps the arc to the travel, none at 0 or past it; the dot stays', () => {
    const { container, rerender } = render(
      <Handle min={0} max={1} value={1} modulations={[modulation(0.5)]} />
    );
    expect(modArcs(container)).toHaveLength(0);
    expect(screen.getAllByTestId('amount-dot')).toHaveLength(1);
    rerender(<Handle min={0} max={1} value={1} modulations={[modulation(0)]} />);
    expect(modArcs(container)).toHaveLength(0);
    rerender(<Handle min={0} max={1} value={1} modulations={[modulation(-0.5)]} />);
    // down to the middle: from the top clockwise
    const start = startPoint(modArcs(container)[0].getAttribute('d') ?? '');
    expect(angleOf(start)).toBeCloseTo(0);
  });

  it('is a drop target with its id, its dots change and remove the routes', () => {
    const onChange = jest.fn();
    const onRemove = jest.fn();
    const { container } = render(
      <Handle
        min={0}
        max={1}
        value={0.5}
        modTarget='osc1.gain'
        modulations={[{ ...modulation(0.25), onChange, onRemove }]}
      />
    );
    expect(container.querySelector('[data-mod-target="osc1.gain"]')).not.toBeNull();
    const dot = screen.getByRole('slider', { name: 'env2' });
    expect(sectionColors()).toEqual(['#f1c40f']);
    fireEvent.keyDown(dot, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(0.26);
    fireEvent.doubleClick(dot);
    expect(onRemove).toHaveBeenCalled();
  });

  describe('live mark', () => {
    afterEach(() => jest.useRealTimers());

    let level: number | null = 1;
    const live = (amount: number, id = 'env2') => ({
      ...modulation(amount, id),
      level: () => level,
      live: true,
    });
    const mark = () => screen.queryByTestId('mod-mark');
    // the angle of the dot painted on the canvas of the mark, clockwise from the top (none: NaN)
    const markAngle = () => {
      const [dot] = drawn(mark());
      const [{ x, y }] = dot?.arcs ?? [{ x: NaN, y: NaN }];
      // the canvas of a knob of size m: 34 px
      return Math.atan2(x - 17, 17 - y);
    };
    const painted = () => drawn(mark()).length > 0;
    const tick = () =>
      act(() => {
        jest.advanceTimersByTime(20);
      });

    it('follows the sum of the routes from the value every frame, the unselected ones too, clamped', () => {
      jest.useFakeTimers();
      level = 1;
      const { rerender } = render(<Handle min={0} max={1} value={0.5} modulations={[live(0.25)]} />);
      // from the top a quarter of the travel clockwise
      expect(markAngle()).toBeCloseTo(MAX_ANGLE / 2);
      rerender(
        <Handle
          min={0}
          max={1}
          value={0.5}
          modulations={[live(0.25), { ...live(-0.5, 'env3'), selected: false }]}
        />
      );
      level = 0.5;
      tick();
      // 0.25 * 0.5 - 0.5 * 0.5
      expect(markAngle()).toBeCloseTo(-MAX_ANGLE / 4);
      rerender(<Handle min={0} max={1} value={0.5} modulations={[live(1)]} />);
      level = 1;
      tick();
      expect(markAngle()).toBeCloseTo(MAX_ANGLE);
    });

    it('a bipolar route moves it around the value: amount × (level - ½)', () => {
      jest.useFakeTimers();
      level = 1;
      render(<Handle min={0} max={1} value={0.5} modulations={[{ ...live(0.5), bipolar: true }]} />);
      // 0.5 + 0.5 × ½
      expect(markAngle()).toBeCloseTo(MAX_ANGLE / 2);
      level = 0;
      tick();
      expect(markAngle()).toBeCloseTo(-MAX_ANGLE / 2);
    });

    it('goes around the travel on a knob around a cycle (wrap), else stops at its end', () => {
      jest.useFakeTimers();
      level = 1;
      const { rerender } = render(<Handle min={0} max={1} value={0.9} wrap modulations={[live(0.3)]} />);
      // 0.9 + 0.3: 0.2 of the travel from its start
      expect(markAngle()).toBeCloseTo(-0.6 * MAX_ANGLE);
      rerender(<Handle min={0} max={1} value={0.9} modulations={[live(0.3)]} />);
      expect(markAngle()).toBeCloseTo(MAX_ANGLE);
    });

    it('is cleared without a level, not rendered while not live and on a disabled knob', () => {
      jest.useFakeTimers();
      level = null;
      const { rerender } = render(<Handle min={0} max={1} value={0.5} modulations={[live(0.25)]} />);
      expect(painted()).toBe(false);
      level = 0.5;
      tick();
      expect(painted()).toBe(true);
      level = null;
      tick();
      expect(painted()).toBe(false);
      rerender(<Handle min={0} max={1} value={0.5} modulations={[{ ...live(0.25), live: false }]} />);
      expect(mark()).toBeNull();
      rerender(<Handle min={0} max={1} value={0.5} disabled modulations={[live(0.25)]} />);
      tick();
      expect(mark()).toBeNull();
    });

    it('paints again only when the sum of the routes moved it by a step of the travel', () => {
      jest.useFakeTimers();
      level = 0.5;
      render(<Handle min={0} max={1} value={0.5} modulations={[live(0.25)]} />);
      const canvas = mark() as HTMLCanvasElement;
      const fill = jest.spyOn(canvas.getContext('2d') as CanvasRenderingContext2D, 'fill');
      tick();
      tick();
      expect(fill).not.toHaveBeenCalled();
      level = 0.5001;
      tick();
      expect(fill).not.toHaveBeenCalled();
      level = 0.6;
      tick();
      expect(fill).toHaveBeenCalledTimes(1);
    });
  });

  it('around a cycle (wrap) draws the arc over its end as two, from the other end on', () => {
    const { container, rerender } = render(
      <Handle min={0} max={1} value={0.9} wrap modulations={[modulation(0.3)]} />
    );
    const [path] = modArcs(container);
    const [, first, second] = (path.getAttribute('d') ?? '').split('M');
    // 0.9 to the end of the travel, then from its start to 0.2
    expect(angleOf(startPoint(`M${first}`))).toBeCloseTo(0.8 * MAX_ANGLE);
    expect(angleOf(startPoint(`M${second}`))).toBeCloseTo(-MAX_ANGLE);
    // clamped: one arc to the end
    rerender(<Handle min={0} max={1} value={0.9} modulations={[modulation(0.3)]} />);
    expect(modArcs(container)[0].getAttribute('d')?.split('M')).toHaveLength(2);
  });

  it('a disabled knob takes no source and hides its routes', () => {
    const { container } = render(
      <Handle min={0} max={1} value={0.5} disabled modTarget='filter.gain' modulations={[modulation(0.25)]} />
    );
    expect(container.querySelector('[data-mod-target]')).toBeNull();
    expect(modArcs(container)).toHaveLength(0);
    expect(screen.queryByTestId('amount-dot')).toBeNull();
  });
});
