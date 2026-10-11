import React from 'react';
import styled from 'styled-components';
import { useIsPortrait } from '@waveform/ui-kit';
import { MobileHeader, MobileMode } from './mobile-header';
import { SynthView } from './synth-view';
import { KeysView } from './keys-view';
import { useLocalStorageState } from './use-local-storage-state';

const Body = styled.div`
  min-height: 0;
  overflow: hidden;
`;

export const MobileLayout = () => {
  const portrait = useIsPortrait();
  const [mode, setMode] = useLocalStorageState<MobileMode>('mobileMode', 'keys');
  return (
    <>
      <MobileHeader portrait={portrait} mode={mode} onModeChange={setMode} />
      <Body>{mode === 'synth' ? <SynthView portrait={portrait} /> : <KeysView portrait={portrait} />}</Body>
    </>
  );
};
