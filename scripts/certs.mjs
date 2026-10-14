// Generates a local certificate for `netlify dev` over HTTPS (see `[dev.https]` in netlify.toml).
// Covers localhost and the current LAN IPv4 addresses, so the app can be opened from other devices.
// Requires mkcert (`brew install mkcert`); run `mkcert -install` once to trust its CA.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === 'IPv4' && !net.internal)
  .map((net) => net.address);

mkdirSync('.certs', { recursive: true });
execFileSync(
  'mkcert',
  [
    '-cert-file',
    '.certs/cert.pem',
    '-key-file',
    '.certs/key.pem',
    'localhost',
    '127.0.0.1',
    '::1',
    ...lanIps,
  ],
  { stdio: 'inherit' }
);
