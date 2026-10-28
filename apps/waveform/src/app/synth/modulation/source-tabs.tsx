import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { distinctUntilChanged, map } from 'rxjs';
import { MdDragIndicator } from 'react-icons/md';
import { ModSource } from '@waveform/preset-schema';
import { startModDrag, theme } from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { ModRoute } from '../common/modules/modulation';
import { useEnvelopes, useModulation } from '../common/modules';
import { SOURCE_COLORS, SOURCE_LABELS } from '../envelope/envelope-colors';

// the whole header (a plain one): a segmented control on its grey, as high as the other headers
const Root = styled.div`
  flex: 1 1;
  min-width: 0;
  display: flex;
  gap: 2px;
  padding: 2px;
`;

// an equal share of the header each, its label white as the titles of the other headers, after a dot of the color
// of its source (the color of its routes on the knobs). The selected one is a white key with a dark label, the one
// a section shows while another section's is selected a translucent one
const Tab = styled.button`
  flex: 1 1 0;
  min-width: 0;
  height: 17px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: inherit;
  color: ${theme.colors.white};
  background: none;
  border: none;
  border-radius: 2px;
  padding: 0 6px;
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  transition: background 120ms, color 120ms;

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  &.selected {
    color: ${theme.colors.primaryDarkMediumContrast};
    background: ${theme.colors.white};
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.12);
    cursor: grab;
  }

  &.shown {
    color: ${theme.colors.primaryDarkMediumContrast};
    background: rgba(255, 255, 255, 0.55);
  }

  /* never an outline: the selected one is a white key */
  &:focus,
  &:focus-visible {
    outline: none;
  }
`;

// a white ring around it (the colors are about as dark as the grey of the header), the number of the routes of
// its source in it (none: empty)
const Dot = styled.span`
  flex: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px ${theme.colors.white};
  font-size: 9px;
  font-weight: 700;
  line-height: 13px;
  text-align: center;
  color: ${theme.colors.white};
`;

// the grip of the selected tab, in its right corner: the label stays centered
const Grip = styled(MdDragIndicator)`
  position: absolute;
  right: 3px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 13px;
  color: ${theme.colors.primaryMediumContrast};
`;

interface Props<S extends ModSource> {
  // the accessible name of the tabs
  label: string;
  sources: readonly S[];
  // the tab of the source the section shows (the ENV section: the last envelope selected), a translucent key while
  // another source is selected; without it the section shows each of its sources (VELO)
  shown?: S;
  // a tab was selected (or dropped on a knob): the section shows it
  onSelect?: (id: S) => void;
  // the knobs its sources go to (all by default): the others don't light up while one is dragged
  accepts?: (target: string) => boolean;
}

// the number of the routes of each source, in their order
const routeCounts = (sources: readonly ModSource[], routes: ModRoute[]) =>
  sources.map((id) => routes.filter(({ source }) => source === id).length);
const sameCounts = (a: number[], b: number[]) => a.every((count, i) => count === b[i]);

// the tabs of sources in the header of a section, ENV 1 | ENV 2 | ENV 3, VELO or LFO 1 | … | LFO 4: the selected one
// (of every source, the tabs of the other sections too) is the source the knobs show the routes of. A tab dragged
// onto a knob assigns its source to it at +50% (bipolar on a knob centered on 0) and selects it, the knobs show the
// new route at once (a click selects it), the grip of the selected one tells it. The dot of a tab has the number
// of the routes of its source: a route added or removed renders the tabs, not an amount
export const SourceTabs = <S extends ModSource>({ label, sources, shown, onSelect, accepts }: Props<S>) => {
  const [{ $selected }, { select: selectSource }] = useEnvelopes();
  const [{ $routes }, { addRoute }] = useModulation();
  const selected = useBehaviorSubject($selected);
  const $counts = React.useMemo(
    () =>
      $routes.pipe(
        map((routes) => routeCounts(sources, routes)),
        distinctUntilChanged(sameCounts)
      ),
    [$routes, sources]
  );
  const counts = useObservable($counts, routeCounts(sources, $routes.value));
  const select = (id: S) => {
    selectSource(id);
    onSelect?.(id);
  };
  return (
    <Root role='tablist' aria-label={label}>
      {sources.map((id, i) => (
        <Tab
          key={id}
          type='button'
          role='tab'
          // the tab of what the section shows: one of each tablist
          aria-selected={shown === undefined || id === shown}
          className={cls({ selected: id === selected, shown: id === shown && id !== selected })}
          onClick={() => select(id)}
          onPointerDown={(e) =>
            startModDrag(e, {
              label: SOURCE_LABELS[id],
              color: SOURCE_COLORS[id],
              accepts,
              onDrop: (target) => {
                addRoute(id, target);
                select(id);
              },
            })
          }
        >
          <Dot aria-hidden data-testid='route-count' style={{ background: SOURCE_COLORS[id] }}>
            {counts[i] || null}
          </Dot>
          {SOURCE_LABELS[id]}
          {id === selected && <Grip aria-hidden data-testid='env-grip' />}
        </Tab>
      ))}
    </Root>
  );
};
