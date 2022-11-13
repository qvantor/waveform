import React from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';
import hexToRgba from 'hex-to-rgba';
import { theme } from '../common/constants';
import { absoluteCenterX, textLight14 } from '../common/styles';

type Trigger = 'mousedown';

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
  ${textLight14};
  ${absoluteCenterX};
  position: absolute;
  padding: 3px 8px;
  background: ${hexToRgba(theme.colors.primaryDarkMediumContrast, 0.8)};
  color: ${theme.colors.white};
  border-radius: ${theme.borderRadius.m};
  white-space: nowrap;
`;

const handle = (trigger: Trigger, element: HTMLElement, show: () => void, hide: () => void) => {
  switch (trigger) {
    case 'mousedown': {
      const hideInternal = (): void => {
        document.removeEventListener('mouseup', hideInternal);
        hide();
      };
      const showInternal = () => {
        document.addEventListener('mouseup', hideInternal);
        show();
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
  trigger = 'mousedown',
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
    if (!refElement.current) return;
    return handle(
      trigger,
      refElement.current,
      () => setShow(true),
      () => setShow(false)
    );
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
        <TooltipWrapper style={{ ...position, opacity: show ? 1 : 0 }}>
          <TooltipInner style={{ bottom }}>{content}</TooltipInner>
        </TooltipWrapper>,
        domNode
      )}
    </>
  );
};
