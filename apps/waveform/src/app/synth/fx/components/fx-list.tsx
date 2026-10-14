import React from 'react';
import cls from 'classnames';
import styled from 'styled-components';
import { MdDragIndicator, MdWarningAmber } from 'react-icons/md';
import { distinctUntilChanged, map } from 'rxjs';
import { isEqual, mapValues } from 'lodash';
import { FxType } from '@waveform/preset-schema';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { Lamp, SortableList, text10, textBold12, theme } from '@waveform/ui-kit';
import { useFx } from '../modules';
import { FX_REGISTRY, isFxUsable } from '../effects';
import { FX_ICONS } from './fx-icons';
import { FX_COLORS } from './fx-colors';
import { fxStatusMessage } from './fx-status-message';

const Root = styled.div`
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: ${theme.colors.primary};
  overflow-y: auto;
`;

const Title = styled.div`
  ${textBold12};
  color: ${theme.colors.primaryHighContrast};
  padding: 3px 5px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 5px;
  /* the left border is always there, so the content doesn't jump when it gets the effect color */
  padding: 7px 10px 7px 9px;
  ${textBold12};
  background: ${theme.colors.primaryLowContrast};
  color: ${theme.colors.white};
  border-left: 3px solid transparent;
  border-radius: ${theme.borderRadius.m};
  user-select: none;
  cursor: pointer;
  transition: background 150ms, border-color 150ms, color 150ms;

  &:hover {
    filter: brightness(1.05);
  }

  &.on {
    background: ${theme.colors.white};
    color: ${theme.colors.primaryDarkMediumContrast};
    border-left-color: var(--fx-color);
  }

  /* can't be turned on: the lamp and the icon fade, the warning under the name says why */
  &.unavailable > :is(button, div) {
    opacity: 0.5;
  }

  &.unsupported {
    cursor: not-allowed;

    &:hover {
      filter: none;
    }
  }
`;

const IconBadge = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: ${theme.borderRadius.m};
  background: ${theme.colors.primary};
  color: ${theme.colors.primaryHighContrast};
  font-size: 16px;
  transition: background 150ms, color 150ms;

  .on > & {
    background: var(--fx-color);
    color: ${theme.colors.white};
  }
`;

const Name = styled.span`
  flex: 1 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const Warning = styled.span`
  display: flex;
  align-items: center;
  gap: 3px;
  ${text10};
  /* the reason may wrap in the narrow list column */
  line-height: 12px;
  font-weight: normal;
  color: ${theme.colors.primaryDarkMediumContrast};

  svg {
    flex: 0 0 auto;
    font-size: 12px;
    color: ${theme.colors.red};
  }
`;

const Grip = styled(MdDragIndicator)`
  flex: 0 0 auto;
  opacity: 0.7;
  cursor: grab;
`;

const addedFlags = (effects: Record<FxType, { added: boolean }>) =>
  mapValues(effects, (effect) => effect.added);

// every effect: a click on the row adds it to the chain, drag & drop sets the chain order
// (dnd-kit swallows the click that ends a drag). An unavailable effect shows why under its name and its lamp
// stays off: an unsupported one can't be added, a click on a failed one loads it again
export const FxList = () => {
  const [{ $order, $effects, $status }, { setAdded, move }] = useFx();
  const order = useBehaviorSubject($order);
  // only the added flags, so dragging a knob doesn't re-render the list
  const $added = React.useMemo(
    () => $effects.pipe(map(addedFlags), distinctUntilChanged(isEqual)),
    [$effects]
  );
  const added = useObservable($added, addedFlags($effects.value));
  const status = useBehaviorSubject($status);
  return (
    <Root>
      <Title>Effects</Title>
      <SortableList
        items={order}
        onMove={move}
        renderItem={(type) => {
          const { label } = FX_REGISTRY[type];
          const Icon = FX_ICONS[type];
          const color = FX_COLORS[type];
          const usable = isFxUsable(status[type]);
          const on = added[type] && usable;
          const warning = fxStatusMessage(status[type]);
          const warningId = `fx-warning-${type}`;
          return (
            <Row
              className={cls({ on, unavailable: !usable, unsupported: status[type] === 'unsupported' })}
              style={{ '--fx-color': color } as React.CSSProperties}
              title={warning}
              onClick={() => setAdded(type, !on)}
            >
              {/* no onChange: its click bubbles to the row, so it toggles once (keyboard too) */}
              <Lamp
                on={on}
                label={label}
                size='m'
                color={color}
                aria-describedby={warning ? warningId : undefined}
              />
              <IconBadge>
                <Icon />
              </IconBadge>
              <Name>
                {label}
                {warning && (
                  <Warning id={warningId}>
                    <MdWarningAmber aria-hidden />
                    {warning}
                  </Warning>
                )}
              </Name>
              <Grip />
            </Row>
          );
        }}
      />
    </Root>
  );
};
