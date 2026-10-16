import type { Context } from '@netlify/functions';
import { request } from '../tests/helpers';
import { empty, errorResponse, getIpHash, HttpError, ipKey, json, readJson, sha256 } from './http';

const post = (body: string) => request('POST', '/', body);

describe('json', () => {
  it('serializes the body with no-store by default', async () => {
    const response = json({ a: 1 });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ a: 1 });
  });

  it('takes the status and overrides headers', () => {
    const response = json([], 201, { 'Cache-Control': 'public, s-maxage=60', 'X-Test': '1' });
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('public, s-maxage=60');
    expect(response.headers.get('X-Test')).toBe('1');
  });
});

describe('empty', () => {
  it('returns 204 without a body by default', async () => {
    const response = empty();
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('takes the status', () => {
    expect(empty(202).status).toBe(202);
  });
});

describe('errorResponse', () => {
  it('returns the status and message of an HttpError', async () => {
    const response = errorResponse(new HttpError(429, 'Slow down'));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Slow down' });
  });

  it('hides other errors behind 500 and logs them', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('connection refused');
    const response = errorResponse(error);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal error' });
    expect(log).toHaveBeenCalledWith(error);
    log.mockRestore();
  });
});

describe('sha256', () => {
  it('returns a hex digest', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('ipKey', () => {
  it('keeps IPv4 addresses', () => {
    expect(ipKey('1.2.3.4')).toBe('1.2.3.4');
  });

  it('takes the /64 of IPv6 addresses in any notation', () => {
    const key = '2001:db8:85a3:42::/64';
    expect(ipKey('2001:db8:85a3:42:1:2:3:4')).toBe(key);
    expect(ipKey('2001:0DB8:85A3:0042:aaaa:bbbb:cccc:dddd')).toBe(key);
    expect(ipKey('2001:db8:85a3:42::1')).toBe(key);
    expect(ipKey('2001:db8:85a3:42:1::')).toBe(key);
    expect(ipKey('2001:db8:85a3:42:1:2:3.4.5.6')).toBe(key);
    expect(ipKey('2001:db8:85a3:43::1')).not.toBe(key);
  });

  it('expands :: inside the /64', () => {
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::1')).toBe('0:0:0:0::/64');
    expect(ipKey('::')).toBe('0:0:0:0::/64');
    expect(ipKey('64:ff9b::1.2.3.4')).toBe('64:ff9b:0:0::/64');
  });

  it('drops the zone id and maps IPv4-mapped addresses to IPv4', () => {
    expect(ipKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ipKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(ipKey('::FFFF:1.2.3.4')).toBe('1.2.3.4');
    expect(ipKey('0:0:0:0:0:ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(ipKey('::ffff:102:304')).toBe('1.2.3.4');
  });

  it('keeps what is not an IP address', () => {
    expect(ipKey('unknown')).toBe('unknown');
  });
});

describe('getIpHash', () => {
  afterEach(() => {
    delete process.env.IP_HASH_SALT;
  });

  it('hashes the ip with the salt', () => {
    process.env.IP_HASH_SALT = 'salt';
    const hash = getIpHash({ ip: '1.2.3.4' } as Context);
    expect(hash).toBe(sha256('1.2.3.4:salt'));
    expect(hash).not.toContain('1.2.3.4');
    expect(getIpHash({ ip: '5.6.7.8' } as Context)).not.toBe(hash);
    process.env.IP_HASH_SALT = 'other';
    expect(getIpHash({ ip: '1.2.3.4' } as Context)).not.toBe(hash);
  });

  it('hashes the /64 of IPv6 addresses', () => {
    process.env.IP_HASH_SALT = 'salt';
    const hash = getIpHash({ ip: '2001:db8:1:2:aaaa::1' } as Context);
    expect(hash).toBe(sha256('2001:db8:1:2::/64:salt'));
    expect(getIpHash({ ip: '2001:db8:1:2:bbbb::2' } as Context)).toBe(hash);
    expect(getIpHash({ ip: '2001:db8:1:3::1' } as Context)).not.toBe(hash);
  });

  it('throws without the salt', () => {
    expect(() => getIpHash({ ip: '1.2.3.4' } as Context)).toThrow('IP_HASH_SALT');
  });
});

describe('readJson', () => {
  it('parses the body', async () => {
    expect(await readJson(post('{"a":[1,2]}'), 100)).toEqual({ a: [1, 2] });
  });

  it('rejects invalid JSON with 400', async () => {
    await expect(readJson(post('{'), 100)).rejects.toMatchObject({ status: 400, message: 'Invalid JSON' });
    await expect(readJson(post(''), 100)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects bodies over the limit in bytes with 413', async () => {
    const body = JSON.stringify('ж'.repeat(5)); // 12 bytes, 7 characters
    await expect(readJson(post(body), 12)).resolves.toBe('жжжжж');
    await expect(readJson(post(body), 11)).rejects.toMatchObject({
      status: 413,
      message: 'Request body is too large',
    });
  });

  it('throws HttpError instances', async () => {
    await expect(readJson(post('nope'), 100)).rejects.toBeInstanceOf(HttpError);
  });
});
