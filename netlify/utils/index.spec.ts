import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2 = {
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'key-id',
  R2_SECRET_ACCESS_KEY: 'secret',
};
const saved = Object.keys(R2).map((name) => [name, process.env[name]] as const);

// the client reads the env as it is loaded
const loadClient = () => {
  Object.assign(process.env, R2);
  let client!: typeof import('./index').client;
  jest.isolateModules(() => {
    ({ client } = require('./index'));
  });
  return client;
};

afterAll(() => {
  saved.forEach(([name, value]) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
});

it('signs a url of the R2 bucket of the account with its keys', async () => {
  const url = new URL(
    await getSignedUrl(
      loadClient(),
      new GetObjectCommand({ Bucket: 'wave-forms', Key: 'ESW Core Tables/Basics/Saw.wav' }),
      { expiresIn: 21600 }
    )
  );
  expect(url.origin).toBe('https://wave-forms.account.r2.cloudflarestorage.com');
  expect(decodeURIComponent(url.pathname)).toBe('/ESW Core Tables/Basics/Saw.wav');
  expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^key-id\/\d{8}\/auto\/s3\/aws4_request$/);
  expect(url.searchParams.get('X-Amz-Expires')).toBe('21600');
});
