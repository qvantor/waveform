import React from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';
import { number } from '@waveform/math';
import { absoluteCenterX } from '../common/styles';
import { singlePointerTracker } from '../common/utils';

type Trigger = 'hold' | 'mousedown';

interface Props {
  content: React.ReactNode;
  trigger?: Trigger;
  bottom?: number;
}

const TooltipElementId = 'tooltip';
// marks the element of a tooltip: a press on a control with a tooltip of its own inside it (the amount dot of a
// knob) shows only that one
const OWNER_ATTR = 'data-tooltip-owner';
// set on a tooltip that doesn't fit the width of the viewport on one line (a knob at its edge) until it hides: its
// content stacks (ValueTooltip puts the name over the value)
export const NARROW_ATTR = 'data-tooltip-narrow';
// px a tooltip keeps from the edges of the viewport
const EDGE = 4;

const TooltipWrapper = styled.div`
  position: fixed;
  pointer-events: none;
  z-index: 50;
  transition: all 100ms;
`;

const TooltipInner = styled.div`
  ${absoluteCenterX};
  position: absolute;
`;

const handle = (
  trigger: Trigger,
  element: HTMLElement,
  tooltip: HTMLDivElement,
  setShow: React.Dispatch<React.SetStateAction<boolean>>
) => {
  switch (trigger) {
    case 'hold': {
      const trackPointer = singlePointerTracker();
      const showInternal = (e: PointerEvent) => {
        if ((e.target as Element | null)?.closest?.(`[${OWNER_ATTR}]`) !== element) return;
        if (trackPointer(e, undefined, () => setShow(false))) setShow(true);
      };
      element.addEventListener('pointerdown', showInternal);
      return () => {
        element.removeEventListener('pointerdown', showInternal);
      };
    }
    case 'mousedown': {
      const hideInternal = (e: MouseEvent) => {
        if (e.target === element) return;
        if (!(e.target instanceof HTMLElement)) return;
        if (tooltip.contains(e.target)) return;
        setShow(false);
        document.removeEventListener('click', hideInternal);
      };
      const showInternal = () => {
        setShow((value) => {
          const newValue = !value;
          newValue
            ? document.addEventListener('click', hideInternal)
            : document.removeEventListener('click', hideInternal);
          return newValue;
        });
      };
      element.addEventListener('mousedown', showInternal);

      return () => {
        element.removeEventListener('mousedown', showInternal);
      };
    }
  }
};

export const Tooltip = ({
  children,
  content,
  trigger = 'hold',
  bottom = -20,
}: React.PropsWithChildren<Props>) => {
  const [show, setShow] = React.useState(false);
  const [position, setPosition] = React.useState({
    left: 0,
    top: 0,
    height: 0,
    width: 0,
  });
  const refElement = React.useRef<HTMLElement>(null);
  const tooltipElement = React.useRef<HTMLDivElement>(null);
  const innerElement = React.useRef<HTMLDivElement>(null);
  const domNode = React.useMemo(() => {
    let element = document.getElementById(TooltipElementId);
    if (!element) {
      element = document.createElement('div') as HTMLDivElement;
      element.setAttribute('id', TooltipElementId);
      document.body.append(element);
    }
    return element;
  }, []);

  React.useEffect(() => {
    if (!refElement.current) return;
    const { current } = refElement;
    const { left, top, height, width } = current.getBoundingClientRect();
    setPosition({ left, top: top, height, width });
  }, [show]);

  // the text it was placed for: a render with the same one (a knob dragged renders with every move) lays nothing
  // out
  const placed = React.useRef<string | null>(null);

  // within the viewport when it shows and with every new text (a new value changes its width): stacked when one
  // line doesn't fit, moved in when it still doesn't; on the element, which goes when it hides
  React.useLayoutEffect(() => {
    const element = refElement.current;
    const inner = innerElement.current;
    if (!inner) {
      placed.current = null;
      return;
    }
    // not laid out
    if (inner.textContent === placed.current || !element || !inner.offsetWidth) return;
    placed.current = inner.textContent;
    const { left, width } = element.getBoundingClientRect();
    const center = left + width / 2;
    const right = document.documentElement.clientWidth - EDGE;
    const offset = () => {
      const half = inner.offsetWidth / 2;
      return number.thresholds(center, EDGE + half, right - half) - center;
    };
    if (offset()) inner.setAttribute(NARROW_ATTR, '');
    inner.style.marginLeft = inner.hasAttribute(NARROW_ATTR) ? `${offset()}px` : '';
  }, [show, content]);

  React.useEffect(() => {
    if (!refElement.current || !tooltipElement.current) return;
    refElement.current.setAttribute(OWNER_ATTR, '');
    return handle(trigger, refElement.current, tooltipElement.current, setShow);
  }, [trigger]);

  if (React.Children.count(children) !== 1) throw new Error('Tooltip required exactly one child');

  return (
    <>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return null;
        return React.cloneElement(child, {
          ...child.props,
          ref: refElement,
        });
      })}
      {ReactDOM.createPortal(
        <TooltipWrapper style={{ ...position }} ref={tooltipElement}>
          {show && (
            <TooltipInner ref={innerElement} style={{ bottom }}>
              {content}
            </TooltipInner>
          )}
        </TooltipWrapper>,
        domNode
      )}
    </>
  );
};
