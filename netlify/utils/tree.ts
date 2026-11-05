import type { _Object } from '@aws-sdk/client-s3';

export interface Dir {
  name: string;
  children: Element[];
}

export type Element = _Object | Dir;

const addElement = (res: Element[], path: string[], obj: _Object): Element[] => {
  if (path.length === 1) return [...res, obj];
  const index = res.findIndex((el) => 'children' in el && el.name === path[0]);
  if (index === -1) {
    return [
      ...res,
      {
        name: path[0],
        children: addElement([], path.slice(1), obj),
      },
    ];
  } else {
    return res.map((item, i) => {
      if (i !== index || !('children' in item)) return item;
      return { ...item, children: addElement(item.children, path.slice(1), obj) };
    });
  }
};

// the objects of a list as a folder tree of their keys; a leaf keeps its whole key
export const listToTree = (list: _Object[]) =>
  list.reduce<Element[]>((sum, item) => addElement(sum, (item.Key ?? '').split('/'), item), []);
