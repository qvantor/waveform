import { createHash } from 'node:crypto';
import { isIPv6, SocketAddress } from 'node:net';
import type { Context } from '@netlify/functions';
import { env } from './env';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

export const empty = (status = 204) =>
  new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export const errorResponse = (error: unknown) => {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: 'Internal error' }, 500);
};

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// a visitor's key: an IPv6 host takes new addresses inside its /64 (privacy extensions rotate them daily),
// so it is the /64; an IPv4-mapped address is its IPv4 one, IPv4 stays as it is
export const ipKey = (ip: string) => {
  if (!isIPv6(ip)) return ip;
  // canonical: lower case, no leading zeros, no zone id, an IPv4-mapped address in any notation is ::ffff:a.b.c.d
  const { address } = new SocketAddress({ address: ip, family: 'ipv6' });
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return mapped[1];
  const [head, tail] = address.split('::').map((part) => (part ? part.split(':') : []));
  const groups = tail ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head;
  return `${groups.slice(0, 4).join(':')}::/64`;
};

export const getIpHash = (context: Context) => sha256(`${ipKey(context.ip)}:${env('IP_HASH_SALT')}`);

export const readJson = async (req: Request, maxBytes: number): Promise<unknown> => {
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, 'Request body is too large');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HttpError(400, 'Invalid JSON');
  }
};
