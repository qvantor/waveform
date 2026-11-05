import { ListObjectsV2Command } from '@aws-sdk/client-s3';

// (what the spec reads of an HttpRequest of the SDK)
interface SignedRequest {
  protocol: string;
  hostname: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
}

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

// the request the client would send, signed (taken right after the signing, nothing sent)
const signedRequest = async (command: ListObjectsV2Command) => {
  const client = loadClient();
  let request: SignedRequest | undefined;
  client.middlewareStack.addRelativeTo(
    () => async (args: { request: unknown }) => {
      request = args.request as SignedRequest;
      return { output: { $metadata: {} }, response: {} };
    },
    { relation: 'after', toMiddleware: 'httpSigningMiddleware', name: 'capture' }
  );
  await client.send(command);
  if (!request) throw new Error('the client sent no request');
  return request;
};

afterAll(() => {
  saved.forEach(([name, value]) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
});

it('lists a bucket of R2 of the account, signed with its keys', async () => {
  const request = await signedRequest(new ListObjectsV2Command({ Bucket: 'wave-forms' }));
  expect(request.protocol).toBe('https:');
  expect(request.hostname).toBe('wave-forms.account.r2.cloudflarestorage.com');
  expect(request.query['list-type']).toBe('2');
  expect(request.headers.authorization).toMatch(
    /^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/auto\/s3\/aws4_request, /
  );
});
