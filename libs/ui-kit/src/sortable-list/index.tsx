import React from 'react';
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import cls from 'classnames';
import styled from 'styled-components';

interface Props<T extends string> {
  items: T[];
  onMove: (from: number, to: number) => void;
  renderItem: (id: T) => React.ReactNode;
  className?: string;
}

const Root = styled.div`
  display: flex;
  flex-direction: column;
`;

const ItemRoot = styled.div`
  position: relative;
  touch-action: none;
  cursor: grab;

  &.dragging {
    z-index: 1;
    cursor: grabbing;
    opacity: 0.85;
  }
`;

const Item = ({ id, children }: React.PropsWithChildren<{ id: string }>) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <ItemRoot
      ref={setNodeRef}
      className={cls({ dragging: isDragging })}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      {children}
    </ItemRoot>
  );
};

// vertical drag & drop list, works with mouse, touch and keyboard
export const SortableList = <T extends string>({ items, onMove, renderItem, className }: Props<T>) => {
  const sensors = useSensors(
    // a small distance, so clicks on the controls inside an item don't start a drag
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onMove(items.indexOf(active.id as T), items.indexOf(over.id as T));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <Root className={className}>
          {items.map((id) => (
            <Item key={id} id={id}>
              {renderItem(id)}
            </Item>
          ))}
        </Root>
      </SortableContext>
    </DndContext>
  );
};
