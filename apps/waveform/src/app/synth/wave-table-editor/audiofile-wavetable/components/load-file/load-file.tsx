import React from 'react';
import toast from 'react-hot-toast';
import styled from 'styled-components';
import { FileDrop, textLight14, theme } from '@waveform/ui-kit';
import { readAudioFile } from '../../../../services/audio-file';
import { Examples } from './examples';

const DropText = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
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
  const bufferToAudio = async (buffer: ArrayBuffer, name?: string) => {
    const { sampleRate, samples } = await readAudioFile(buffer);
    if (samples.length / sampleRate > 12) {
      toast.error(`${name ?? 'File'} duration is bigger than 12 seconds`);
      return;
    }
    onLoad(samples);
  };
  const onFileDrop = async (file: File) => {
    const buffer = await file.arrayBuffer();
    await bufferToAudio(buffer, file.name);
  };
  return (
    <FileDrop onFileDrop={onFileDrop}>
      <DropText>
        <h1>Drop audiofile here</h1>
        <span>Up to 2 seconds</span>
        <Examples onLoad={bufferToAudio} />
      </DropText>
    </FileDrop>
  );
};
