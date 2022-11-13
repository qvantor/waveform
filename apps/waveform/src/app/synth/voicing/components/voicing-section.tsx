import React from 'react';
import styled from 'styled-components';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { DraggableNumber, Section, Checkbox, theme } from '@waveform/ui-kit';
import { RxHandle } from '../../../common/components';
import { useSynth } from '../../common/modules';

const Root = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 5px;
`;

const ControlsContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
`;

const Voices = styled.div`
  font-size: 12px;
  line-height: 12px;
  text-align: right;
  background: ${theme.colors.primaryLowContrast};
  border-radius: 3px;
  color: ${theme.colors.white};
  padding: 5px 6px;
  font-weight: 600;

  span {
    font-weight: 400;
  }
`;
const HandleContainer = styled.div`
  flex: 1 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;

export const VoicingSection = () => {
  const [{ $maxVoices, $legato, $portamento, $voicesCount }, { setMaxVoices, setPortamento, setLegato }] =
    useSynth();
  const maxVoices = useBehaviorSubject($maxVoices);
  const legato = useBehaviorSubject($legato);
  const voicesCount = useBehaviorSubject($voicesCount);
  return (
    <Section name='Voicing'>
      <Root>
        <ControlsContainer>
          <div />
          <DraggableNumber value={maxVoices} range={[1, 12]} label='Poly' onChange={setMaxVoices} />
          <Checkbox checked={legato} onChange={setLegato} label='Legato' />
          <Voices>
            <span>{voicesCount} /</span> {maxVoices}
          </Voices>
        </ControlsContainer>
        <HandleContainer>
          <RxHandle
            $value={$portamento}
            min={0}
            max={400}
            label='Portamento'
            onChange={setPortamento}
            plotSize={200}
            precision={1}
            formatValue={(value) => `${value}ms`}
          />
        </HandleContainer>
      </Root>
    </Section>
  );
};
