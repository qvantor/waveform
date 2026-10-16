import React from 'react';
import styled from 'styled-components';
import { Button, Empty, Popconfirm, Spin, Tooltip } from 'antd';
import { AiOutlineFire, AiOutlineFlag, AiOutlineLink } from 'react-icons/ai';
import toast from 'react-hot-toast';
import { theme } from '@waveform/ui-kit';
import { PresetListItem } from '@waveform/preset-schema';
import { reportPreset, sharePreset } from '../services';

const List = styled.div`
  height: 50vh;
  overflow-y: auto;
  border: 1px solid ${theme.colors.primaryLowContrast};
`;

const Row = styled.div<{ active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 4px 12px;
  cursor: pointer;
  border-bottom: 1px solid ${theme.colors.primary};
  background: ${({ active }) => (active ? theme.colors.primary : 'transparent')};
  color: ${({ active }) => (active ? theme.colors.secondAccent : theme.colors.primaryDark)};

  &:hover {
    background: ${theme.colors.primary};
  }
`;

const Name = styled.div`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Popularity = styled.span`
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: ${theme.colors.primaryHighContrast};
`;

const Center = styled.div`
  display: flex;
  justify-content: center;
  padding: 12px;
`;

interface Props {
  items: PresetListItem[];
  currentId?: string;
  loading: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onSelect: (item: PresetListItem) => void;
}

export const PresetList = ({ items, currentId, loading, hasMore, onLoadMore, onSelect }: Props) => {
  const root = React.useRef<HTMLDivElement>(null);
  const sentinel = React.useRef<HTMLDivElement>(null);

  // infinite scroll: load the next page when the end of the list becomes visible
  React.useEffect(() => {
    if (!hasMore || loading || !sentinel.current) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && onLoadMore?.(), {
      root: root.current,
    });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  const share = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    sharePreset(id);
  };

  const report = (id: string) =>
    reportPreset(id)
      .then(() => toast.success('Thanks, the preset has been reported'))
      .catch((e) => toast.error(e.message));

  return (
    <List ref={root}>
      {items.map((item) => (
        <Row key={item.id} active={item.id === currentId} onClick={() => onSelect(item)}>
          <Name>{item.name}</Name>
          {item.uniqueUsers > 0 && (
            <Popularity>
              <AiOutlineFire />
              {item.uniqueUsers}
            </Popularity>
          )}
          <Tooltip title='Copy link'>
            <Button type='text' size='small' icon={<AiOutlineLink />} onClick={(e) => share(e, item.id)} />
          </Tooltip>
          <Popconfirm
            title='Report this preset?'
            okText='Report'
            onConfirm={(e) => {
              e?.stopPropagation();
              report(item.id);
            }}
            onCancel={(e) => e?.stopPropagation()}
          >
            <Button type='text' size='small' icon={<AiOutlineFlag />} onClick={(e) => e.stopPropagation()} />
          </Popconfirm>
        </Row>
      ))}
      {loading && (
        <Center>
          <Spin />
        </Center>
      )}
      {!loading && items.length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No presets' />
      )}
      {hasMore && <div ref={sentinel} style={{ height: 1 }} />}
    </List>
  );
};
