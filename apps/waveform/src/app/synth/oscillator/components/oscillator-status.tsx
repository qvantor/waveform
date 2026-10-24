import React from 'react';
import styled from 'styled-components';
import { MdWarningAmber } from 'react-icons/md';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { text12, theme } from '@waveform/ui-kit';
import { useSynthCore } from '../../common/modules';
import type { TableState, WavetableStatus } from '../../common/wavetable/wavetable-engine';
import { useOscillatorContext } from '../hooks';

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

// why the table of an oscillator doesn't play (the one before it does); none: it plays, or it is on its way
export const tableStateMessage = (state: TableState | null) => {
  switch (state) {
    case 'refused':
      return 'Not enough memory for the table: the previous one plays';
    case 'failed':
      return 'The table failed to build: the previous one plays';
    default:
      return undefined;
  }
};

// over the wave of an oscillator: the reason it doesn't play, Retry for a module that failed to load (the limiter
// too, if it failed: LimiterStatus shows it); else why its table doesn't, Retry sends it again
export const OscillatorStatus = () => {
  const [{ wavetables }, { retryAudio }] = useSynthCore();
  const [{ $tableState }, { retryTable }] = useOscillatorContext();
  const status = useBehaviorSubject(wavetables.$status);
  const tableState = useObservable($tableState, null);
  const message = oscillatorStatusMessage(status);
  const tableMessage = tableStateMessage(tableState);
  if (!message && !tableMessage) return null;
  // (the module first: without it no table plays)
  const retry = message ? status === 'failed' && retryAudio : retryTable;
  return (
    <Root role='alert'>
      <MdWarningAmber aria-hidden />
      <span>{message ? <>Oscillators can&apos;t play: {message}</> : tableMessage}</span>
      {retry && (
        <Retry type='button' onClick={retry}>
          Retry
        </Retry>
      )}
    </Root>
  );
};
