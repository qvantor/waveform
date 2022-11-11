import React from 'react'
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { DraggableNumber, Section } from '@waveform/ui-kit';
import { RxHandle } from '../../../common/components';
import { useSynth } from '../../common/modules';

export const VoicingSection = () => {
  const [{ $maxVoices, $legato, $portamento, $voicesCount }, { setMaxVoices, setPortamento, setLegato }] =
    useSynth();
  const maxVoices = useBehaviorSubject($maxVoices);
  const legato = useBehaviorSubject($legato);
  const voicesCount = useBehaviorSubject($voicesCount);
  return (
    <Section name='Voicing'>
      <DraggableNumber value={maxVoices} range={[1, 12]} label='Poly' onChange={setMaxVoices} />
      <div>
        {voicesCount} / {maxVoices}
      </div>
      <RxHandle
        $value={$portamento}
        min={0}
        max={400}
        label='Porta'
        onChange={setPortamento}
        plotSize={200}
        precision={1}
      />
      <input type='checkbox' checked={legato} onChange={(e) => setLegato(e.target.checked)} />
    </Section>
  );
};
