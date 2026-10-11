import { env } from './env';

export const verifyTurnstile = async (token: string, ip: string) => {
  const body = new URLSearchParams({ secret: env('TURNSTILE_SECRET'), response: token, remoteip: ip });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success: boolean };
  return result.success;
};
