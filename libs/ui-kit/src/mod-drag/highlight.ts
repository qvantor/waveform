import { css } from 'styled-components';
import { MOD_DRAGGING_CLASS, MOD_OVER_ATTR, MOD_REFUSED_ATTR, MOD_TARGET_ATTR } from '.';

// the highlight of a control a source can be dropped on: lit while a source is dragged, brighter under the
// pointer; `path` the combinator from the element with MOD_TARGET_ATTR to it ('>' a child, '> * >' a grandchild)
export const modDragHighlight = (path: string) => css`
  pointer-events: none;
  display: none;

  body.${MOD_DRAGGING_CLASS} [${MOD_TARGET_ATTR}]:not([${MOD_REFUSED_ATTR}]) ${path} & {
    display: block;
    box-shadow: 0 0 0 2px var(--mod-drag-color);
  }

  body.${MOD_DRAGGING_CLASS} [${MOD_OVER_ATTR}] ${path} & {
    box-shadow: 0 0 0 3px var(--mod-drag-color), 0 0 12px 3px var(--mod-drag-color);
  }
`;
