import React from 'react';
import styled from 'styled-components';
import { MdWarningAmber } from 'react-icons/md';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { text12, theme } from '@waveform/ui-kit';
import { useSynthCore } from '../../common/modules';
import type { WavetableStatus } from '../../common/wavetable/wavetable-engine';

// why the oscillators can't play (there is no native fallback); none: they can (or they are loading)
export const oscillatorStatusMessage = (status: WavetableStatus) => {
  switch (status) {
    // browsers expose AudioWorklet only on https and localhost (e.g. not on http://<LAN IP>)
    case 'unsupported':
      return window.isSecureContext === false ? 'Needs HTTPS or localhost' : 'Not supported by this browser';
    case 'failed':
      return 'Failed to load';
    default:
      return undefined;
  }
};

const Root = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 8px;
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

// a text button, as in the warning of a failed effect
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

// over the wave of an oscillator: the reason it doesn't play, Retry for a module that failed to load
export const OscillatorStatus = () => {
  const [{ wavetables }] = useSynthCore();
  const status = useBehaviorSubject(wavetables.$status);
  const message = oscillatorStatusMessage(status);
  if (!message) return null;
  return (
    <Root role='alert'>
      <MdWarningAmber aria-hidden />
      <span>Oscillators can&apos;t play: {message}</span>
      {status === 'failed' && (
        <Retry type='button' onClick={wavetables.retry}>
          Retry
        </Retry>
      )}
    </Root>
  );
};
