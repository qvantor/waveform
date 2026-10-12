import type { Context } from '@netlify/functions';
import { sha256 } from '../utils/http';

export const ID = '0b5c7c8e-4a52-4d7e-9b0e-1f2a3b4c5d6e';
export const OTHER_ID = '7d0f6c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6';

export const context = { ip: '1.2.3.4' } as Context;

// specs set process.env.IP_HASH_SALT to IP_SALT, getIpHash(context) then returns IP_HASH
export const IP_SALT = 'salt';
export const IP_HASH = sha256(`${context.ip}:${IP_SALT}`);

export const request = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
