import React from 'react';
import styled from 'styled-components';
import { Tooltip } from 'antd';
import { AiOutlineLeft, AiOutlineLink, AiOutlineRight, AiOutlineSave } from 'react-icons/ai';
import toast from 'react-hot-toast';
import { IconButton, theme } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useApp } from '../../app';
import { usePresets } from '../modules/presets';
import { usePresetUsageTracker } from '../hooks/use-preset-usage-tracker';
import { sharePreset } from '../services';
import { PresetBrowser } from './preset-browser';
import { SaveDialog } from './save-dialog';

const Root = styled.div`
  flex: 0 0 33%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const NameButton = styled.button`
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 12px;
  border: 1px solid ${theme.colors.primaryLowContrast};
  border-radius: ${theme.borderRadius.m};
  background: ${theme.colors.white};
  color: ${theme.colors.primaryDark};
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    border-color: ${theme.colors.secondAccent};
  }
`;

const Dirty = styled.span`
  color: ${theme.colors.secondAccent};
`;

export const PresetPanel = ({ className }: { className?: string }) => {
  const [{ $saveRequest }] = useApp();
  const [{ $current, $dirty, $list }, { next, prev }] = usePresets();
  const current = useBehaviorSubject($current);
  const dirty = useBehaviorSubject($dirty);
  const list = useBehaviorSubject($list);
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);

  usePresetUsageTracker();

  // Cmd/Ctrl+S
  React.useEffect(() => {
    const subscription = $saveRequest.subscribe(() => setSaveOpen(true));
    return () => subscription.unsubscribe();
  }, [$saveRequest]);

  const share = () => {
    if (!current) {
      toast.error('Save the preset first to share it');
      return;
    }
    sharePreset(current.id);
  };

  return (
    <Root className={className}>
      <IconButton onClick={prev} disabled={list.length === 0}>
        <AiOutlineLeft />
      </IconButton>
      <NameButton onClick={() => setBrowserOpen(true)}>
        {current?.name ?? 'Init'}
        {dirty && <Dirty> *</Dirty>}
      </NameButton>
      <IconButton onClick={next} disabled={list.length === 0}>
        <AiOutlineRight />
      </IconButton>
      <Tooltip title='Save as a new preset (⌘S)'>
        <IconButton onClick={() => setSaveOpen(true)}>
          <AiOutlineSave />
        </IconButton>
      </Tooltip>
      <Tooltip title='Copy link'>
        <IconButton onClick={share}>
          <AiOutlineLink />
        </IconButton>
      </Tooltip>
      <PresetBrowser open={browserOpen} onClose={() => setBrowserOpen(false)} />
      <SaveDialog open={saveOpen} onClose={() => setSaveOpen(false)} />
    </Root>
  );
};
