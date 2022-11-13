import React from 'react';
import styled from 'styled-components';
import { theme } from '../common/constants';

interface Props {
  onFileDrop?: (file: File) => void;
}

interface StyledProps {
  droppable: boolean;
}

const FileDropRoot = styled.div<StyledProps>`
  transition: all 150ms;
  background: ${({ droppable }) => (droppable ? theme.colors.primaryLowContrast : theme.colors.primary)};

  box-shadow: ${({ droppable }) =>
    droppable
      ? `inset 0 0 0 10px ${theme.colors.primaryLowContrast}, inset 0 0 0 11px ${theme.colors.primary}`
      : 'none'};
`;

export const FileDrop = ({ children, onFileDrop }: React.PropsWithChildren<Props>) => {
  const [droppable, setDroppable] = React.useState(false);
  const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const item = e.dataTransfer.items[0];
    if (item.kind === 'file' && /audio/.test(item.type)) {
      setDroppable(true);
    }
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!droppable) return;
    setDroppable(false);
    const file = e.dataTransfer.files[0];
    onFileDrop?.(file);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDroppable(false);
  };
  return (
    <FileDropRoot
      droppable={droppable}
      onDragEnter={onDragEnter}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {children}
    </FileDropRoot>
  );
};
