import { Handler } from '@netlify/functions';
import { getHeaders, client } from '../utils';
import { ListObjectsCommand, _Object } from '@aws-sdk/client-s3';

interface Dir {
  name: string;
  children: Element[];
}

type Element = _Object | Dir;

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

const listToTree = (list: _Object[]) =>
  list.reduce<Element[]>((sum, item) => addElement(sum, item.Key.split('/'), item), []);

const handler: Handler = async () => {
  const result = await client.send(new ListObjectsCommand({ Bucket: process.env.BUCKET }));
  return {
    statusCode: 200,
    headers: getHeaders(),
    body: JSON.stringify(listToTree(result.Contents)),
  };
};

export { handler };
