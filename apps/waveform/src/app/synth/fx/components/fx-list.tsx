import React from 'react';
import cls from 'classnames';
import styled from 'styled-components';
import { MdDragIndicator } from 'react-icons/md';
import { distinctUntilChanged, map } from 'rxjs';
import { isEqual, mapValues } from 'lodash';
import { FxType } from '@waveform/preset-schema';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { Lamp, SortableList, textBold12, theme } from '@waveform/ui-kit';
import { useFx } from '../modules';
import { FX_REGISTRY } from '../effects';
import { FX_ICONS } from './fx-icons';
import { FX_COLORS } from './fx-colors';

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
`;

const Grip = styled(MdDragIndicator)`
  flex: 0 0 auto;
  opacity: 0.7;
  cursor: grab;
`;

const addedFlags = (effects: Record<FxType, { added: boolean }>) =>
  mapValues(effects, (effect) => effect.added);

// every available effect: a click on the row adds it to the chain, drag & drop sets the chain order
// (dnd-kit swallows the click that ends a drag)
export const FxList = () => {
  const [{ $order, $effects }, { setAdded, move }] = useFx();
  const order = useBehaviorSubject($order);
  // only the added flags, so dragging a knob doesn't re-render the list
  const $added = React.useMemo(
    () => $effects.pipe(map(addedFlags), distinctUntilChanged(isEqual)),
    [$effects]
  );
  const added = useObservable($added, addedFlags($effects.value));
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
          return (
            <Row
              className={cls({ on: added[type] })}
              style={{ '--fx-color': color } as React.CSSProperties}
              onClick={() => setAdded(type, !added[type])}
            >
              {/* no onChange: its click bubbles to the row, so it toggles once (keyboard too) */}
              <Lamp on={added[type]} label={label} size='m' color={color} />
              <IconBadge>
                <Icon />
              </IconBadge>
              <Name>{label}</Name>
              <Grip />
            </Row>
          );
        }}
      />
    </Root>
  );
};
