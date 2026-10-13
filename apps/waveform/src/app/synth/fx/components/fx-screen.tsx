import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { theme } from '@waveform/ui-kit';
import { FxList } from './fx-list';
import { FxRack } from './fx-rack';

const Root = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
  gap: 1px;
  min-height: 0;
  background: ${theme.colors.primaryLowContrast};

  &.column {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: max-content 1fr;
  }
`;

interface Props {
  className?: string;
  // column: the list above the rack (portrait phone)
  layout?: 'row' | 'column';
}

export const FxScreen = ({ className, layout = 'row' }: Props) => (
  <Root className={cls(className, layout)}>
    <FxList />
    <FxRack />
  </Root>
);
