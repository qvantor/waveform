import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { HandlerResponse } from '@netlify/functions';
import { client } from '../utils';
import { handler } from '../functions/get-noises-list';

jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  client: { send: jest.fn() },
}));

const send = client.send as jest.Mock;

const list = async () => {
  const response = (await handler({} as any, {} as any)) as HandlerResponse;
  return { ...response, tree: JSON.parse(response.body as string) };
};
const page = (keys: string[], next?: string) => ({
  Contents: keys.map((Key) => ({ Key, Size: 2, ETag: '"x"' })),
  IsTruncated: next !== undefined,
  NextContinuationToken: next,
});

beforeEach(() => {
  send.mockReset();
  process.env.R2_NOISES_BUCKET = 'noises';
});

afterAll(() => {
  delete process.env.R2_NOISES_BUCKET;
});

it('lists the noise bucket as a tree of its folders, a leaf its key and size', async () => {
  send.mockResolvedValueOnce(page(['Analog/', 'Analog/White.wav', 'Analog/Pink.wav', 'Textures/Rain.wav']));
  const response = await list();
  const [command] = send.mock.calls[0];
  expect(command).toBeInstanceOf(ListObjectsV2Command);
  expect(command.input).toEqual({ Bucket: 'noises', ContinuationToken: undefined });
  expect(response.statusCode).toBe(200);
  expect(response.headers?.['Access-Control-Allow-Origin']).toBe('*');
  expect(response.tree).toEqual([
    {
      name: 'Analog',
      children: [
        { Key: 'Analog/White.wav', Size: 2 },
        { Key: 'Analog/Pink.wav', Size: 2 },
      ],
    },
    { name: 'Textures', children: [{ Key: 'Textures/Rain.wav', Size: 2 }] },
  ]);
});

it('reads every page of the list', async () => {
  send.mockResolvedValueOnce(page(['A/one.wav'], 'next')).mockResolvedValueOnce(page(['A/two.wav']));
  const { tree } = await list();
  expect(send.mock.calls[1][0].input.ContinuationToken).toBe('next');
  expect(tree).toEqual([
    {
      name: 'A',
      children: [
        { Key: 'A/one.wav', Size: 2 },
        { Key: 'A/two.wav', Size: 2 },
      ],
    },
  ]);
});

it('answers an empty list without samples', async () => {
  send.mockResolvedValueOnce({ IsTruncated: false });
  expect((await list()).tree).toEqual([]);
});
