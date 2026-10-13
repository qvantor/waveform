import React from 'react';
import styled, { css } from 'styled-components';
import cls from 'classnames';
import { theme } from '@waveform/ui-kit';
import { FxScreen } from '../fx';
import { SynthScreen } from '../screens';
import { KeyboardTier } from './keyboard-tier';
import { Scaled } from './scaled';
import { SynthSections } from './synth-sections';
import { useLocalStorageState } from './use-local-storage-state';

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const miniPanel = css`
  border-bottom: 1px solid ${theme.colors.primaryLowContrast};

  &.landscape {
    flex-basis: 38%;
  }
`;

const MiniSynth = styled(Scaled)`
  flex: 0 0 auto;
  max-height: 40%;
  ${miniPanel}
`;

const MiniFx = styled(FxScreen)`
  flex: 0 0 40%;
  ${miniPanel}
`;

const Tiers = styled.div`
  flex: 1 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  padding: 6px 4px 4px;
`;

const isOctaves = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isInteger);

export const KeysView = ({ portrait, screen }: { portrait: boolean; screen: SynthScreen }) => {
  const [octaves, setOctaves] = useLocalStorageState<[number, number]>(
    'mobileKeyboardOctaves',
    [4, 3],
    isOctaves
  );
  const octavesCount = portrait ? 1 : 2;
  const setTierOctave = (tier: number) => (octave: number) =>
    setOctaves((prev) => prev.map((o, i) => (i === tier ? octave : o)) as [number, number]);
  const panelClassName = cls({ landscape: !portrait });

  return (
    <Root>
      {screen === 'fx' ? (
        <MiniFx className={panelClassName} />
      ) : (
        <MiniSynth className={panelClassName} width={portrait ? 900 : 1600} fitHeight={!portrait}>
          <SynthSections layout={portrait ? 'grid' : 'row'} />
        </MiniSynth>
      )}
      <Tiers>
        {octaves.map((octave, tier) => (
          <KeyboardTier
            key={tier}
            octave={octave}
            octavesCount={octavesCount}
            onOctaveChange={setTierOctave(tier)}
          />
        ))}
      </Tiers>
    </Root>
  );
};
