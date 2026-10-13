import React from 'react';
import styled from 'styled-components';
import { useObservable } from '@waveform/rxjs-react';
import { textBold12, theme } from '@waveform/ui-kit';
import { getChain, useFx } from '../modules';
import { FxPanel } from './fx-panel';

const Root = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  grid-auto-rows: minmax(180px, max-content);
  align-content: start;
  background: ${theme.colors.primary};
  overflow-y: auto;

  // separators only around the panels, the empty space stays light
  & > * {
    box-shadow: 1px 1px 0 ${theme.colors.primaryLowContrast};
  }
`;

const Empty = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${theme.colors.primary};
  color: ${theme.colors.primaryMediumContrast};
  ${textBold12};
`;

// the effects in the chain, in the chain order
export const FxRack = () => {
  const [{ $chain, $order, $effects }] = useFx();
  const chain = useObservable($chain, getChain($order.value, $effects.value));
  if (chain.length === 0) return <Empty>Turn on an effect in the list</Empty>;
  return (
    <Root>
      {chain.map((type) => (
        <FxPanel key={type} type={type} />
      ))}
    </Root>
  );
};
