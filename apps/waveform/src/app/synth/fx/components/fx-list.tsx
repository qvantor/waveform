import React from 'react';
import styled from 'styled-components';
import { MdDragIndicator } from 'react-icons/md';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { Lamp, SortableList, textBold12, theme } from '@waveform/ui-kit';
import { useFx } from '../modules';
import { FX_REGISTRY } from '../effects';

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
  padding: 6px 8px;
  ${textBold12};
  background: ${theme.colors.primaryLowContrast};
  color: ${theme.colors.white};
  border-radius: 3px;
  user-select: none;
`;

const Name = styled.span`
  flex: 1 1;
`;

const Grip = styled(MdDragIndicator)`
  flex: 0 0 auto;
  opacity: 0.7;
`;

// every available effect: the lamp adds it to the chain, drag & drop sets the chain order
export const FxList = () => {
  const [{ $order, $effects }, { setAdded, move }] = useFx();
  const order = useBehaviorSubject($order);
  const effects = useBehaviorSubject($effects);
  return (
    <Root>
      <Title>Effects</Title>
      <SortableList
        items={order}
        onMove={move}
        renderItem={(type) => (
          <Row>
            <Lamp
              on={effects[type].added}
              onChange={(added) => setAdded(type, added)}
              label={FX_REGISTRY[type].label}
            />
            <Name>{FX_REGISTRY[type].label}</Name>
            <Grip />
          </Row>
        )}
      />
    </Root>
  );
};
