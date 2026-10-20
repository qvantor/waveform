// dragging a modulation source (an ENV tab) onto a knob, on pointer events (HTML5 drag and drop doesn't work on
// touch screens). The knobs that take it carry MOD_TARGET_ATTR (their target id) and light up while a source
// is dragged (MOD_DRAGGING_CLASS on the body, the color of the source in --mod-drag-color); the one under the
// pointer carries MOD_OVER_ATTR. An element with MOD_DWELL_ATTR (the osc/fx switch) is clicked once the label
// has stayed on it for DWELL ms: the knobs of the other screen come up. Near the top or the bottom of a
// scrolled container (the portrait column of a phone) it scrolls by itself

export const MOD_TARGET_ATTR = 'data-mod-target';
export const MOD_OVER_ATTR = 'data-mod-over';
export const MOD_DWELL_ATTR = 'data-mod-dwell';
export const MOD_DRAGGING_CLASS = 'mod-dragging';

// px the pointer moves before a press becomes a drag (less is a click)
const THRESHOLD = 4;
const DWELL = 600;
// px from the edge of a scrolled container the scrolling starts at, px per frame at the edge
const EDGE = 48;
const SCROLL_SPEED = 14;

export interface ModDragOptions {
  // the label following the pointer and its color
  label: string;
  color: string;
  // dropped on a knob: its target id
  onDrop: (target: string) => void;
}

const isScrollable = (element: Element) => {
  const { overflowY } = getComputedStyle(element);
  return (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight;
};

const scrollParent = (element: Element | null) => {
  for (let current = element; current; current = current.parentElement)
    if (isScrollable(current)) return current;
  return null;
};

const createLabel = ({ label, color }: ModDragOptions) => {
  const element = document.createElement('div');
  element.textContent = label;
  element.setAttribute('data-testid', 'mod-drag-label');
  Object.assign(element.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    zIndex: '100',
    pointerEvents: 'none',
    padding: '2px 6px',
    borderRadius: '3px',
    font: '600 12px sans-serif',
    color: '#fff',
    background: color,
    boxShadow: '0 3px 8px rgb(0 0 0 / 35%)',
    whiteSpace: 'nowrap',
  });
  document.body.append(element);
  return element;
};

// a press on a source: a drag once it has moved THRESHOLD px, else nothing (the click of the source happens as
// usual); the click that ends a drag is swallowed
export const startModDrag = (
  event: { pointerId: number; button: number; clientX: number; clientY: number },
  options: ModDragOptions
) => {
  if (event.button !== 0) return;
  const { pointerId } = event;
  const start = { x: event.clientX, y: event.clientY };
  let position = start;
  let label: HTMLElement | null = null;
  let over: Element | null = null;
  let dwell: { element: Element; timer: number } | null = null;
  let frame = 0;

  const setOver = (target: Element | null) => {
    if (target === over) return;
    over?.removeAttribute(MOD_OVER_ATTR);
    target?.setAttribute(MOD_OVER_ATTR, '');
    over = target;
  };

  const setDwell = (element: Element | null) => {
    if (element === (dwell?.element ?? null)) return;
    if (dwell) window.clearTimeout(dwell.timer);
    dwell = element
      ? {
          element,
          timer: window.setTimeout(() => {
            (element as HTMLElement).click();
            dwell = null;
          }, DWELL),
        }
      : null;
  };

  const hover = () => {
    const element = document.elementFromPoint?.(position.x, position.y) ?? null;
    setOver(element?.closest(`[${MOD_TARGET_ATTR}]`) ?? null);
    setDwell(element?.closest(`[${MOD_DWELL_ATTR}]`) ?? null);
  };

  // scrolls the container under the pointer while it is near its top or bottom
  const scroll = () => {
    frame = 0;
    const container = scrollParent(document.elementFromPoint?.(position.x, position.y) ?? null);
    if (!container) return;
    const { top, bottom } = container.getBoundingClientRect();
    const near = (distance: number) => Math.max(0, 1 - distance / EDGE);
    const speed = SCROLL_SPEED * (near(bottom - position.y) - near(position.y - top));
    if (speed === 0) return;
    container.scrollTop += speed;
    hover();
    frame = window.requestAnimationFrame(scroll);
  };

  const begin = () => {
    label = createLabel(options);
    document.body.classList.add(MOD_DRAGGING_CLASS);
    document.body.style.setProperty('--mod-drag-color', options.color);
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    position = { x: e.clientX, y: e.clientY };
    if (!label) {
      if (Math.hypot(position.x - start.x, position.y - start.y) < THRESHOLD) return;
      begin();
    }
    if (label) label.style.transform = `translate(${position.x + 8}px, ${position.y - 24}px)`;
    hover();
    if (!frame) frame = window.requestAnimationFrame(scroll);
  };

  // the click the browser sends after a drag is not a click on the source
  const swallowClick = () => {
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }));
  };

  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
    if (frame) window.cancelAnimationFrame(frame);
    setDwell(null);
    if (!label) return;
    const target = e.type === 'pointerup' ? over?.getAttribute(MOD_TARGET_ATTR) : null;
    setOver(null);
    label.remove();
    document.body.classList.remove(MOD_DRAGGING_CLASS);
    document.body.style.removeProperty('--mod-drag-color');
    swallowClick();
    if (target) options.onDrop(target);
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
};
