import { verifyTurnstile } from './turnstile';

describe('verifyTurnstile', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.TURNSTILE_SECRET = 'secret';
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TURNSTILE_SECRET;
  });

  const reply = (ok: boolean, body: unknown) =>
    fetchMock.mockResolvedValue({ ok, json: async () => body } as Response);

  it('posts the token, the secret and the ip to Cloudflare', async () => {
    reply(true, { success: true });
    await verifyTurnstile('token', '1.2.3.4');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body)).toEqual({
      secret: 'secret',
      response: 'token',
      remoteip: '1.2.3.4',
    });
  });

  it('returns the verification result', async () => {
    reply(true, { success: true });
    expect(await verifyTurnstile('token', '1.2.3.4')).toBe(true);
    reply(true, { success: false });
    expect(await verifyTurnstile('token', '1.2.3.4')).toBe(false);
  });

  it('fails when Cloudflare responds with an error', async () => {
    reply(false, { success: true });
    expect(await verifyTurnstile('token', '1.2.3.4')).toBe(false);
  });

  it('throws without the secret', async () => {
    delete process.env.TURNSTILE_SECRET;
    await expect(verifyTurnstile('token', '1.2.3.4')).rejects.toThrow('TURNSTILE_SECRET');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
