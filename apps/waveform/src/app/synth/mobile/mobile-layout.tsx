import React from 'react';
import styled from 'styled-components';
import { useIsPortrait } from '@waveform/ui-kit';
import { SynthScreen } from '../screens';
import { MobileHeader, MobileMode } from './mobile-header';
import { SynthView } from './synth-view';
import { KeysView } from './keys-view';
import { useLocalStorageState } from './use-local-storage-state';

const Body = styled.div`
  min-height: 0;
  overflow: hidden;
`;

const isMode = (value: unknown): value is MobileMode => value === 'synth' || value === 'keys';

interface Props {
  screen: SynthScreen;
  onScreenChange: (screen: SynthScreen) => void;
}

export const MobileLayout = ({ screen, onScreenChange }: Props) => {
  const portrait = useIsPortrait();
  const [mode, setMode] = useLocalStorageState<MobileMode>('mobileMode', 'keys', isMode);
  return (
    <>
      <MobileHeader
        portrait={portrait}
        mode={mode}
        onModeChange={setMode}
        screen={screen}
        onScreenChange={onScreenChange}
      />
      <Body>
        {mode === 'synth' ? (
          <SynthView portrait={portrait} screen={screen} />
        ) : (
          <KeysView portrait={portrait} screen={screen} />
        )}
      </Body>
    </>
  );
};
