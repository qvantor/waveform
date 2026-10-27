import {
  MOD_DRAGGING_CLASS,
  MOD_DWELL_ATTR,
  MOD_OVER_ATTR,
  MOD_REFUSED_ATTR,
  MOD_TARGET_ATTR,
  startModDrag,
} from './index';

const pointer = (type: string, [clientX, clientY]: [number, number], target: EventTarget = document) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
};

// a knob that takes a source, a plain element and the element the pointer is over
const setup = () => {
  document.body.innerHTML = `
    <div id="scroll"><div id="knob" ${MOD_TARGET_ATTR}="osc1.gain"><span id="inner"></span></div>
    <div id="plain"></div><button id="switch" ${MOD_DWELL_ATTR}></button></div>`;
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  let under: Element | null = null;
  Object.assign(document, { elementFromPoint: jest.fn(() => under) });
  const onDrop = jest.fn();
  const drag = (accepts?: (target: string) => boolean) =>
    startModDrag(
      { pointerId: 1, button: 0, clientX: 0, clientY: 0 },
      {
        label: 'ENV 2',
        color: '#f1c40f',
        onDrop,
        accepts,
      }
    );
  return { byId, onDrop, drag, over: (element: Element | null) => (under = element) };
};

const label = () => document.querySelector('[data-testid="mod-drag-label"]');

describe('startModDrag', () => {
  // the swallowed click of a drag is let go after its task
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  it('a target its source does not go to lights up not, takes no drop; the marks go with the drag', () => {
    const { drag, byId, over, onDrop } = setup();
    drag((target) => target !== 'osc1.gain');
    over(byId('inner'));
    pointer('pointermove', [20, 20]);
    expect(byId('knob').hasAttribute(MOD_REFUSED_ATTR)).toBe(true);
    expect(byId('knob').hasAttribute(MOD_OVER_ATTR)).toBe(false);
    pointer('pointerup', [20, 20]);
    expect(onDrop).not.toHaveBeenCalled();
    expect(byId('knob').hasAttribute(MOD_REFUSED_ATTR)).toBe(false);
  });

  it('marks the targets of a screen the dwell brought up too', () => {
    const { drag, byId, over } = setup();
    byId('switch').addEventListener('click', () => {
      const knob = document.createElement('div');
      knob.id = 'later';
      knob.setAttribute(MOD_TARGET_ATTR, 'osc2.gain');
      document.body.append(knob);
    });
    drag((target) => !target.endsWith('.gain'));
    over(byId('switch'));
    pointer('pointermove', [20, 20]);
    jest.advanceTimersByTime(600);
    expect(byId('later').hasAttribute(MOD_REFUSED_ATTR)).toBe(true);
    pointer('pointerup', [20, 20]);
    expect(byId('later').hasAttribute(MOD_REFUSED_ATTR)).toBe(false);
  });

  it('a target it goes to takes it', () => {
    const { drag, byId, over, onDrop } = setup();
    drag((target) => target === 'osc1.gain');
    over(byId('inner'));
    pointer('pointermove', [20, 20]);
    pointer('pointerup', [20, 20]);
    expect(onDrop).toHaveBeenCalledWith('osc1.gain');
  });

  it('becomes a drag after 4 px: a label of the color of the source follows the pointer', () => {
    const { drag } = setup();
    drag();
    pointer('pointermove', [2, 2]);
    expect(label()).toBeNull();
    pointer('pointermove', [10, 0]);
    expect(label()?.textContent).toBe('ENV 2');
    expect((label() as HTMLElement).style.background).toBe('rgb(241, 196, 15)');
    expect(document.body.classList.contains(MOD_DRAGGING_CLASS)).toBe(true);
    pointer('pointerup', [10, 0]);
    expect(label()).toBeNull();
    expect(document.body.classList.contains(MOD_DRAGGING_CLASS)).toBe(false);
  });

  it('marks the knob under the pointer and drops onto it', () => {
    const { drag, byId, over, onDrop } = setup();
    drag();
    over(byId('inner'));
    pointer('pointermove', [20, 20]);
    expect(byId('knob').hasAttribute(MOD_OVER_ATTR)).toBe(true);
    pointer('pointerup', [20, 20]);
    expect(onDrop).toHaveBeenCalledWith('osc1.gain');
    expect(byId('knob').hasAttribute(MOD_OVER_ATTR)).toBe(false);
  });

  it('drops nothing off a knob, on a cancel or after a click', () => {
    const { drag, byId, over, onDrop } = setup();
    drag();
    over(byId('plain'));
    pointer('pointermove', [20, 20]);
    pointer('pointerup', [20, 20]);
    drag();
    over(byId('knob'));
    pointer('pointermove', [20, 20]);
    pointer('pointercancel', [20, 20]);
    drag();
    pointer('pointerup', [0, 0]);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('swallows the click that ends a drag, a plain press clicks', () => {
    const { drag, byId } = setup();
    const onClick = jest.fn();
    byId('plain').addEventListener('click', onClick);
    drag();
    pointer('pointerup', [0, 0]);
    byId('plain').click();
    expect(onClick).toHaveBeenCalledTimes(1);
    drag();
    pointer('pointermove', [30, 0]);
    pointer('pointerup', [30, 0]);
    byId('plain').click();
    expect(onClick).toHaveBeenCalledTimes(1);
    // only that one
    jest.runOnlyPendingTimers();
    byId('plain').click();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('clicks the switch the label stays on for 600 ms', () => {
    const { drag, byId, over } = setup();
    const onClick = jest.fn();
    byId('switch').addEventListener('click', onClick);
    drag();
    over(byId('switch'));
    pointer('pointermove', [20, 20]);
    jest.advanceTimersByTime(500);
    expect(onClick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(onClick).toHaveBeenCalledTimes(1);
    // passed over: nothing
    over(byId('plain'));
    pointer('pointermove', [30, 30]);
    over(byId('switch'));
    pointer('pointermove', [40, 40]);
    over(byId('plain'));
    pointer('pointermove', [50, 50]);
    jest.advanceTimersByTime(1000);
    expect(onClick).toHaveBeenCalledTimes(1);
    pointer('pointerup', [50, 50]);
  });

  it('scrolls a scrolled container near its bottom edge', () => {
    const { drag, byId, over } = setup();
    const container = byId('scroll');
    container.style.overflowY = 'auto';
    Object.defineProperties(container, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } });
    container.getBoundingClientRect = () => ({ top: 0, bottom: 500 } as DOMRect);
    drag();
    over(byId('plain'));
    pointer('pointermove', [20, 490]);
    jest.advanceTimersByTime(100);
    expect(container.scrollTop).toBeGreaterThan(0);
    const scrolled = container.scrollTop;
    // in the middle: it stops
    pointer('pointermove', [20, 250]);
    jest.advanceTimersByTime(100);
    expect(container.scrollTop).toBeLessThanOrEqual(scrolled + 14);
    pointer('pointerup', [20, 250]);
  });
});
