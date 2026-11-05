import React from 'react';
import { styled } from 'styled-components';
import { MdWarningAmber } from 'react-icons/md';
import { useBehaviorSubject, useObservable } from '@chisper/rxjs-react';
import { text12, theme } from '@chisper/ui-kit';
import { useNoise, useSynthCore } from '../../common/modules';
import type { TableState } from '../../common/wavetable/wavetable-engine';
import { oscillatorStatusMessage } from '../../oscillator/components/oscillator-status';

const Root = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 6px;
  ${text12};
  line-height: 16px;
  text-align: center;
  color: ${theme.colors.primaryDarkHighContrast};
  background: ${theme.colors.primaryDark}cc;

  svg {
    flex: 0 0 auto;
    font-size: 12px;
    color: ${theme.colors.red};
  }
`;

const Retry = styled.button`
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-weight: bold;
  color: ${theme.colors.secondAccent};
  text-decoration: underline;
  cursor: pointer;

  &:focus {
    outline: none;
  }

  &:focus-visible {
    outline: 1px solid ${theme.colors.secondAccent};
    outline-offset: 2px;
  }
`;

// why the sample of the noise doesn't play (the one before it does); none: it plays, or it is on its way
export const sampleStateMessage = (state: TableState | null) => {
  switch (state) {
    case 'refused':
      return 'Not enough memory for the sample';
    case 'failed':
      return 'The sample failed to load';
    default:
      return undefined;
  }
};

// over the overview of the noise while it is on: why it can't play (the oscillators can't: Retry loads them
// again), else why its sample doesn't (Retry sends it again)
export const NoiseStatus = () => {
  const [{ wavetables }, { retryAudio }] = useSynthCore();
  const [{ $active, $sampleState }, { retrySample }] = useNoise();
  const active = useBehaviorSubject($active);
  const status = useBehaviorSubject(wavetables.$status);
  const sampleState = useObservable($sampleState, null);
  if (!active) return null;
  const message = oscillatorStatusMessage(status);
  const sampleMessage = sampleStateMessage(sampleState);
  if (!message && !sampleMessage) return null;
  const retry = message ? status === 'failed' && retryAudio : retrySample;
  return (
    <Root role='alert'>
      <MdWarningAmber aria-hidden />
      <span>{message ? <>Noise can&apos;t play: {message}</> : sampleMessage}</span>
      {retry && (
        <Retry type='button' onClick={retry}>
          Retry
        </Retry>
      )}
    </Root>
  );
};
