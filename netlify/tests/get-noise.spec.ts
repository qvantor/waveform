import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { client } from '../utils';
import { handler } from '../functions/get-noise';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const getSignedUrlMock = getSignedUrl as jest.Mock;

const get = (queryStringParameters: Record<string, string> | null) =>
  handler({ queryStringParameters } as any, {} as any) as Promise<any>;

beforeEach(() => {
  getSignedUrlMock.mockReset().mockResolvedValue('https://s3.example/signed');
  process.env.R2_NOISES_BUCKET = 'noises';
});

afterAll(() => {
  delete process.env.R2_NOISES_BUCKET;
});

it('returns a signed url of a sample of the noise bucket for 6 hours', async () => {
  const response = await get({ id: 'Analog/White noise.wav' });
  expect(response.statusCode).toBe(200);
  expect(response.body).toBe('https://s3.example/signed');
  expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
  const [s3, command, options] = getSignedUrlMock.mock.calls[0];
  expect(s3).toBe(client);
  expect(command).toBeInstanceOf(GetObjectCommand);
  expect(command.input).toEqual({ Bucket: 'noises', Key: 'Analog/White noise.wav' });
  expect(options).toEqual({ expiresIn: 21600 });
});

it.each([
  ['without id', {}],
  ['without query string', null],
  ['with an empty id', { id: '' }],
  ['out of the bucket', { id: '../secret.json' }],
  ['out of a folder', { id: 'Analog/../../secret.json' }],
])('rejects a request %s with 400', async (_, query) => {
  expect((await get(query)).statusCode).toBe(400);
  expect(getSignedUrlMock).not.toHaveBeenCalled();
});
