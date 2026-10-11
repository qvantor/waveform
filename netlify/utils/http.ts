import { createHash } from 'node:crypto';
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

export const getIpHash = (context: Context) => sha256(`${context.ip}:${env('IP_HASH_SALT')}`);

export const readJson = async (req: Request, maxBytes: number): Promise<unknown> => {
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, 'Request body is too large');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HttpError(400, 'Invalid JSON');
  }
};
