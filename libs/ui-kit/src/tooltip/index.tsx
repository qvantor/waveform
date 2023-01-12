import React from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';
import { absoluteCenterX } from '../common/styles';

type Trigger = 'hold' | 'mousedown';

interface Props {
  content: React.ReactNode;
  trigger?: Trigger;
  bottom?: number;
}

const TooltipElementId = 'tooltip';

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
      const hideInternal = (): void => {
        document.removeEventListener('mouseup', hideInternal);
        setShow(false);
      };
      const showInternal = () => {
        document.addEventListener('mouseup', hideInternal);
        setShow(true);
      };
      element.addEventListener('mousedown', showInternal);
      return () => {
        element.removeEventListener('mousedown', showInternal);
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

  React.useEffect(() => {
    if (!refElement.current || !tooltipElement.current) return;
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
          {show && <TooltipInner style={{ bottom }}>{content}</TooltipInner>}
        </TooltipWrapper>,
        domNode
      )}
    </>
  );
};
