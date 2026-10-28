import React from 'react';
import styled, { css } from 'styled-components';
import cls from 'classnames';
import { theme, useElementSize } from '@waveform/ui-kit';
import { FxScreen } from '../fx';
import { PitchBend } from '../pitch-bend';
import { SynthScreen } from '../screens';
import { OCTAVE_WIDTH, OctaveControl, TierKeys, tierOctave } from './keyboard-tier';
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

// the share of the view the mini synth takes in portrait at most
const MINI_SHARE = 0.4;

const MiniSynth = styled(Scaled)`
  flex: 0 0 auto;
  max-height: ${MINI_SHARE * 100}%;
  ${miniPanel}
`;

// the whole fx screen at a fixed width (the list above the rack in portrait), scaled down to fit the panel
// like the mini synth: every effect on one or two lines
const MiniFx = styled(Scaled)`
  flex: 0 0 40%;
  ${miniPanel}
`;

// a column as wide as the octave buttons left of the keys of both tiers: in portrait the octaves of both tiers
// and the wheel under them, in landscape the wheel, the octave of each tier between it and its keys
const Tiers = styled.div`
  flex: 1 1;
  min-height: 0;
  display: grid;
  grid-template-columns: ${OCTAVE_WIDTH}px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px 4px;
  padding: 6px 4px 4px;

  &.landscape {
    grid-template-columns: ${OCTAVE_WIDTH}px ${OCTAVE_WIDTH}px minmax(0, 1fr);
  }
`;

// the left column, as high as both tiers
const Side = styled.div`
  grid-row: 1 / -1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

// the rest of the column: the wheel as high as it
const Wheel = styled.div`
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  justify-content: center;
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
  const tiers = octaves.map((stored, tier) => ({
    octave: tierOctave(stored, octavesCount),
    octavesCount,
    onOctaveChange: setTierOctave(tier),
  }));
  const panelClassName = cls({ landscape: !portrait });
  const [rootRef, [, height]] = useElementSize<HTMLDivElement>();

  return (
    <Root ref={rootRef}>
      {screen === 'fx' ? (
        <MiniFx className={panelClassName} width={portrait ? 760 : 1400}>
          <FxScreen layout={portrait ? 'column' : 'row'} />
        </MiniFx>
      ) : (
        <MiniSynth
          className={panelClassName}
          width={portrait ? 900 : 1850}
          fitHeight={!portrait}
          // (in portrait its rows follow its width, at most the share of the view of its max-height)
          maxHeight={portrait ? MINI_SHARE * height : undefined}
        >
          <SynthSections layout={portrait ? 'grid' : 'row'} />
        </MiniSynth>
      )}
      <Tiers className={panelClassName}>
        <Side>
          {portrait && tiers.map((tier, i) => <OctaveControl key={i} {...tier} />)}
          <Wheel>
            {/* alone: its range is the preset's */}
            <PitchBend compact />
          </Wheel>
        </Side>
        {tiers.map((tier, i) => (
          <React.Fragment key={i}>
            {!portrait && <OctaveControl {...tier} />}
            <TierKeys {...tier} />
          </React.Fragment>
        ))}
      </Tiers>
    </Root>
  );
};
