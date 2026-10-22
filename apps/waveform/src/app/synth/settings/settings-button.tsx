import { MdSettings } from 'react-icons/md';
import styled from 'styled-components';
import { Label, Select, PanelButton, theme } from '@waveform/ui-kit';
import { useEffect, useState } from 'react';
import { Popover } from 'antd';
import toast from 'react-hot-toast';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { ToastActions, ToastBody, ToastButton } from '../../common/components';
import { useSynthCore } from '../common/modules';
import { canCountDropouts } from '../common/latency/dropouts';
import {
  autoLatency,
  canChooseLatency,
  canKeepLatency,
  Latency,
  LatencyMode,
  readLatencyMode,
  reloadPage,
  setLatencyMode,
  switchToNormalLatency,
} from '../common/latency/latency';

const Content = styled.div`
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

// a label sits closer to its select than to the field above
const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Note = styled.div`
  font-size: 12px;
  color: ${theme.colors.primaryHighContrast};
`;

const NoteButton = styled.button`
  margin-left: 4px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: ${theme.colors.secondAccent};
  text-decoration: underline;
  cursor: pointer;
`;

// a square key of the icon alone, as ◀ ▶ of the presets above it
const GearButton = styled(PanelButton)`
  flex: 0 0 40px;
  gap: 0;
  padding: 0;
`;

const DROPOUT_TOAST = 'latency-dropouts';

const LATENCY_NAMES: Record<Latency, string> = { low: 'Low', normal: 'Normal' };

// Auto chosen shows the latency it picked: Auto (Low)
const latencyOptions = (mode: LatencyMode, auto: Latency): { name: string; value: LatencyMode }[] => [
  { name: mode === 'auto' ? `Auto (${LATENCY_NAMES[auto]})` : 'Auto', value: 'auto' },
  { name: LATENCY_NAMES.low, value: 'low' },
  { name: LATENCY_NAMES.normal, value: 'normal' },
];

export const SettingsButton = () => {
  const [open, setOpen] = useState(false);
  const [{ $dropouts, $dropoutWarning }, { dismissDropoutWarning }] = useSynthCore();
  const dropouts = useBehaviorSubject($dropouts);
  const warning = useBehaviorSubject($dropoutWarning);
  // the mode stored: the context plays at the one it was created with until the reload
  const [mode] = useState(readLatencyMode);
  // the storage keeps a choice (a probe that writes: once)
  const [keeps] = useState(canKeepLatency);

  // too many dropouts at low latency: once, until the user answers it
  useEffect(() => {
    if (!warning) return;
    const answer = (switchNow: boolean) => {
      toast.dismiss(DROPOUT_TOAST);
      dismissDropoutWarning();
      if (switchNow) switchToNormalLatency();
    };
    toast(
      <ToastBody>
        The sound crackles. Switch to Normal for a steady sound?
        <ToastActions>
          <ToastButton onClick={() => answer(true)}>Switch to Normal</ToastButton>
          <ToastButton className='secondary' onClick={() => answer(false)}>
            Not now
          </ToastButton>
        </ToastActions>
      </ToastBody>,
      { id: DROPOUT_TOAST, duration: Infinity }
    );
  }, [warning, dismissDropoutWarning]);

  const changeMode = (next: LatencyMode) => {
    setLatencyMode(next);
    reloadPage();
  };

  // where the browser counts no dropouts nothing warns of them and auto stays normal (latency.ts)
  const counts = canCountDropouts();
  // what auto has learnt (after dropouts in this session it differs from the latency playing); Auto chosen in
  // the select again would change nothing, so a key forgets it
  const auto = autoLatency();
  const learntNormal = mode === 'auto' && counts && auto === 'normal';
  // short, in the words of what is heard: the response of the keys and a crackle; the select names the latency
  const note = () => {
    if (mode === 'low')
      return counts
        ? 'Faster response, may crackle on a slow computer.'
        : 'Faster response. If the sound crackles, choose Normal.';
    if (mode === 'normal') return 'Slightly slower response, steady sound.';
    if (!counts) return 'Always Normal in this browser.';
    return learntNormal ? 'Low crackled on this computer.' : 'Switches to Normal if the sound crackles.';
  };

  const latencyField = () => {
    if (!canChooseLatency()) return <Note>This browser sets the latency itself.</Note>;
    if (!keeps) return <Note>Normal: site data is blocked, a choice would not be kept.</Note>;
    return (
      <>
        {/* no arrows: a step through Low on the way to Normal would be a reload */}
        <Select value={mode} options={latencyOptions(mode, auto)} onChange={changeMode} arrows={false} />
        <Note>
          {note()}
          {learntNormal && <NoteButton onClick={() => changeMode('auto')}>Try low again</NoteButton>}
        </Note>
        {dropouts !== null && <Note>Dropouts since the page opened: {dropouts}</Note>}
      </>
    );
  };

  return (
    <Popover
      trigger='click'
      placement='bottom'
      content={
        <Content>
          <Field>
            <Label>Latency</Label>
            {latencyField()}
          </Field>
        </Content>
      }
      open={open}
      onOpenChange={setOpen}
    >
      <GearButton icon={<MdSettings />} active={open} aria-label='Settings' />
    </Popover>
  );
};
