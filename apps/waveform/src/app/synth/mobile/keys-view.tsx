import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { theme } from '@waveform/ui-kit';
import { KeyboardTier } from './keyboard-tier';
import { Scaled } from './scaled';
import { SynthSections } from './synth-sections';
import { useLocalStorageState } from './use-local-storage-state';

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const MiniSynth = styled(Scaled)`
  flex: 0 0 auto;
  max-height: 40%;
  border-bottom: 1px solid ${theme.colors.primaryLowContrast};

  &.landscape {
    flex-basis: 38%;
  }
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

export const KeysView = ({ portrait }: { portrait: boolean }) => {
  const [octaves, setOctaves] = useLocalStorageState<[number, number]>('mobileKeyboardOctaves', [4, 3]);
  const octavesCount = portrait ? 1 : 2;
  const setTierOctave = (tier: number) => (octave: number) =>
    setOctaves((prev) => prev.map((o, i) => (i === tier ? octave : o)) as [number, number]);

  return (
    <Root>
      <MiniSynth
        className={cls({ landscape: !portrait })}
        width={portrait ? 900 : 1600}
        fitHeight={!portrait}
      >
        <SynthSections layout={portrait ? 'grid' : 'row'} />
      </MiniSynth>
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
