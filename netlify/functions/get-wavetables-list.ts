import { Handler } from '@netlify/functions';
import { getHeaders, client } from '../utils';
import { ListObjectsCommand, _Object } from '@aws-sdk/client-s3';

interface Dir {
  name: string;
  children: Element[];
}

interface File {
  key: string;
  name: string;
}

type Element = File | Dir;

const addElement = (res: Element[], path: string[], obj: _Object) => {
  if (path.length === 1) return [...res, obj];
  const index = res.findIndex((el) => el.name === path[0]);
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
      if (i !== index) return item;
      if (!('children' in item)) throw new Error('Add element error');
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
