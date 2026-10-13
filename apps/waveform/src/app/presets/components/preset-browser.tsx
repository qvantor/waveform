import React from 'react';
import styled from 'styled-components';
import { Button, Input, Modal, Radio, Tabs } from 'antd';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { PresetListItem, PresetSort } from '@waveform/preset-schema';
import { usePresets } from '../modules/presets';
import { useDebounced } from '../hooks/use-debounced';
import { listPresets } from '../services';
import { PresetList } from './preset-list';

const SEARCH_DEBOUNCE_MS = 300;

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const sortOptions: { label: string; value: PresetSort }[] = [
  { label: 'New', value: 'new' },
  { label: 'A–Z', value: 'name' },
  { label: 'Popular', value: 'popular' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export const PresetBrowser = ({ open, onClose }: Props) => {
  const [{ $current, $top, $topLoading }, { loadById, loadTop, setList }] = usePresets();
  const current = useBehaviorSubject($current);
  const top = useBehaviorSubject($top);
  const topLoading = useBehaviorSubject($topLoading);
  const [tab, setTab] = React.useState<'popular' | 'all'>('popular');
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<PresetSort>('new');
  const q = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);

  React.useEffect(() => {
    if (q) setTab('all');
  }, [q]);

  // popular presets are loaded by the model on start, retried here if that failed
  React.useEffect(() => {
    if (open && !$top.value) loadTop();
  }, [open, $top, loadTop]);

  const all = useInfiniteQuery({
    queryKey: ['presets', 'list', q, sort],
    queryFn: ({ pageParam }) => listPresets({ q, sort, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: open && tab === 'all',
    staleTime: 60 * 1000,
  });
  const allItems = React.useMemo(() => all.data?.pages.flatMap((page) => page.items) ?? [], [all.data]);

  // the preset is applied right away, the modal stays open to compare sounds
  const select = (items: PresetListItem[]) => (item: PresetListItem) => {
    setList(items);
    loadById(item.id);
  };

  const { fetchNextPage } = all;
  const loadMore = React.useCallback(() => fetchNextPage(), [fetchNextPage]);

  return (
    <Modal
      title='Presets'
      open={open}
      onCancel={onClose}
      width={600}
      footer={
        <Button type='primary' onClick={onClose}>
          Done
        </Button>
      }
    >
      <Content>
        <Input.Search
          placeholder='Search all presets'
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'popular' | 'all')}
          tabBarExtraContent={
            tab === 'all' && (
              <Radio.Group
                size='small'
                optionType='button'
                options={sortOptions}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              />
            )
          }
          items={[
            {
              key: 'popular',
              label: 'Popular',
              children: (
                <PresetList
                  items={top ?? []}
                  currentId={current?.id}
                  loading={topLoading}
                  onSelect={select(top ?? [])}
                />
              ),
            },
            {
              key: 'all',
              label: q ? `Search: ${q}` : 'All',
              children: (
                <PresetList
                  items={allItems}
                  currentId={current?.id}
                  loading={all.isLoading || all.isFetchingNextPage}
                  hasMore={all.hasNextPage}
                  onLoadMore={loadMore}
                  onSelect={select(allItems)}
                />
              ),
            },
          ]}
        />
      </Content>
    </Modal>
  );
};
