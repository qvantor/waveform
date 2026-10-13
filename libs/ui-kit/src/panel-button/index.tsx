import React from 'react';
import cls from 'classnames';
import hexToRgba from 'hex-to-rgba';
import styled from 'styled-components';
import { theme } from '../common/constants';
import { textBold12 } from '../common/styles';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  active?: boolean;
  // a small green dot after the label, e.g. "connected"
  indicator?: boolean;
};

// pressed into the panel, a lighter version of the tape key's sunken shadow
const sunken = `
  inset 0 4px 6px -3px rgb(0 0 0 / 20%),
  inset 0 1px 2px rgb(0 0 0 / 12%)
`;

// fills its whole cell, so a row of them reads as one strip of keys
const Root = styled.button`
  flex: 1 1 0;
  min-width: 0;
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  border: none;
  background: ${theme.colors.primary};
  color: ${theme.colors.primaryHighContrast};
  ${textBold12};
  letter-spacing: 1.5px;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 120ms, color 120ms, box-shadow 80ms ease-out;

  svg {
    flex: 0 0 auto;
    font-size: 15px;
  }

  &:hover {
    background: ${theme.colors.white};
    color: ${theme.colors.primaryDarkMediumContrast};
  }

  &:active,
  &.active {
    background: ${theme.colors.primary};
    box-shadow: ${sunken};
  }

  &.active {
    color: ${theme.colors.secondAccent};
  }

  &:disabled {
    cursor: default;
    color: ${theme.colors.primaryLowContrast};
    background: ${theme.colors.primary};
    box-shadow: none;
  }
`;

const Label = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;

  // only the icon is shown, the label stays for screen readers
  &.hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    clip-path: inset(50%);
  }
`;

const Indicator = styled.span`
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${theme.colors.accent};
  box-shadow: 0 0 4px 1px ${hexToRgba(theme.colors.accent, 0.6)};
`;

// true when the label doesn't fit next to the icon (phones); back to false once the button is wide enough
const useLabelOverflow = (
  rootRef: React.RefObject<HTMLButtonElement>,
  labelRef: React.RefObject<HTMLSpanElement>,
  enabled: boolean
) => {
  const [overflow, setOverflow] = React.useState(false);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const label = labelRef.current;
    if (!enabled || !root || !label || typeof ResizeObserver === 'undefined') return;
    let hidden = false;
    let fitsAt = 0; // the button width at which the label fits again
    const update = () => {
      if (!hidden) {
        const cut = label.scrollWidth - label.clientWidth;
        if (cut <= 0) return;
        fitsAt = root.clientWidth + cut;
      } else if (root.clientWidth < fitsAt) return;
      hidden = !hidden;
      setOverflow(hidden);
    };
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => {
      observer.disconnect();
      setOverflow(false);
    };
  }, [rootRef, labelRef, enabled]);
  return overflow;
};

export const PanelButton = React.forwardRef<HTMLButtonElement, Props>(
  ({ icon, active = false, indicator = false, className, children, ...rest }, ref) => {
    const rootRef = React.useRef<HTMLButtonElement>(null);
    const labelRef = React.useRef<HTMLSpanElement>(null);
    React.useImperativeHandle(ref, () => rootRef.current as HTMLButtonElement);
    // without an icon the label is all there is, it is cut with an ellipsis instead
    const labelHidden = useLabelOverflow(rootRef, labelRef, Boolean(icon));
    return (
      <Root ref={rootRef} type='button' className={cls(className, { active })} {...rest}>
        {icon}
        <Label ref={labelRef} className={cls({ hidden: labelHidden })}>
          {children}
        </Label>
        {indicator && <Indicator data-testid='panel-button-indicator' />}
      </Root>
    );
  }
);
PanelButton.displayName = 'PanelButton';
