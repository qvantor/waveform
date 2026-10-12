import { ListObjectsCommand } from '@aws-sdk/client-s3';
import type { HandlerResponse } from '@netlify/functions';
import { client } from '../utils';
import { handler } from '../functions/get-wavetables-list';

jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  client: { send: jest.fn() },
}));

const send = client.send as jest.Mock;

const list = async (keys: string[]) => {
  send.mockResolvedValue({ Contents: keys.map((Key) => ({ Key, Size: 1 })) });
  const response = (await handler({} as any, {} as any)) as HandlerResponse;
  return { ...response, tree: JSON.parse(response.body as string) };
};

beforeEach(() => {
  send.mockReset();
  process.env.BUCKET = 'tables';
});

afterAll(() => {
  delete process.env.BUCKET;
});

it('lists the bucket', async () => {
  const response = await list([]);
  const [command] = send.mock.calls[0];
  expect(command).toBeInstanceOf(ListObjectsCommand);
  expect(command.input).toEqual({ Bucket: 'tables' });
  expect(response.statusCode).toBe(200);
  expect(response.headers).toEqual({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTION',
  });
  expect(response.tree).toEqual([]);
});

it('builds a folder tree from the keys', async () => {
  const { tree } = await list(['root.wav', 'A/B/one.wav', 'A/B/two.wav', 'A/three.wav', 'C/four.wav']);
  expect(tree).toEqual([
    { Key: 'root.wav', Size: 1 },
    {
      name: 'A',
      children: [
        {
          name: 'B',
          children: [
            { Key: 'A/B/one.wav', Size: 1 },
            { Key: 'A/B/two.wav', Size: 1 },
          ],
        },
        { Key: 'A/three.wav', Size: 1 },
      ],
    },
    { name: 'C', children: [{ Key: 'C/four.wav', Size: 1 }] },
  ]);
});

it.each([
  ['the file', ['A/B', 'A/B/one.wav']],
  ['the folder', ['A/B/one.wav', 'A/B']],
])('keeps a file and a folder with the same name when %s comes first', async (_, keys) => {
  const { tree } = await list(keys);
  expect(tree).toEqual([
    {
      name: 'A',
      children: expect.arrayContaining([
        { Key: 'A/B', Size: 1 },
        { name: 'B', children: [{ Key: 'A/B/one.wav', Size: 1 }] },
      ]),
    },
  ]);
});
