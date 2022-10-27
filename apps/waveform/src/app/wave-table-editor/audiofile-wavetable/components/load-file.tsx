import React from 'react';
import { FileDrop, textLight14, theme } from '@waveform/ui-kit';
import styled from 'styled-components';
import { useAudioProcessor } from '../../wave-table-editor';

const DropText = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  user-select: none;
  gap: 5px;

  h1 {
    text-transform: uppercase;
    font-weight: 600;
    color: ${theme.colors.primaryLowContrast};
  }

  span {
    ${textLight14};
    color: ${theme.colors.primaryMediumContrast};
  }
`;

interface Props {
  onLoad: (audioBuffer: Float32Array) => void;
}

// @todo add here input with file select on click
export const LoadFile = ({ onLoad }: Props) => {
  const [{ audioCtx }] = useAudioProcessor();
  const onFileDrop = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(buffer);
    if (audioBuffer.duration > 2) return;
    const data = audioBuffer.getChannelData(0);
    onLoad(data);
  };
  return (
    <FileDrop onFileDrop={onFileDrop}>
      <DropText>
        <h1>Drop audiofile here</h1>
        <span>Up to 2 seconds</span>
      </DropText>
    </FileDrop>
  );
};
