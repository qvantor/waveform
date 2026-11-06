// what the benchmarks of scripts/ share (bench-osc, bench-perf): the root of the repo and its require, the
// arguments, Playwright (not a dependency of the project: from `npx -p playwright`), the env of .env, the tables
// of the bucket
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// (the domains of the buckets as the app has them; Node strips the types)
import { bucketUrl, WAVETABLES_ORIGIN } from '../apps/chisper/src/app/synth/services/buckets.ts';

export { WAVETABLES_ORIGIN };

// (fileURLToPath: in a URL a path with spaces or non-ASCII letters is percent-encoded)
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const require = createRequire(path.join(root, 'package.json'));

// --key=value, a bare --flag is 'true'
export const parseArgs = (argv) =>
  Object.fromEntries(
    argv.map((arg) => {
      const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
      return [key, value];
    })
  );

// playwright from `npx -p playwright` (its .bin is on the PATH) or installed somewhere node finds it
export const loadPlaywright = () => {
  const candidates = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => dir.endsWith(path.join('node_modules', '.bin')))
    .map((dir) => path.join(dir, '..', 'playwright'));
  for (const candidate of candidates)
    if (fs.existsSync(candidate)) return createRequire(candidate + '/')(candidate);
  return require('playwright');
};

export const readEnv = () => {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
};

// a bucket of the site, Cloudflare R2 through its S3 API (the R2_* of .env): the tables (R2_BUCKET) or the noise
// samples (R2_NOISES_BUCKET); scripts/noises/upload.mjs writes there
export const siteBucket = (bucket = 'R2_BUCKET') => {
  readEnv();
  const names = ['R2_ACCOUNT_ID', bucket, 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`${missing.join(', ')} of .env: the R2 bucket of the site`);
  const { S3Client } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return { client, Bucket: process.env[bucket] };
};

export const fileName = (key) => key.split('/').at(-1);

// the tables of the bucket of the site (their keys) into `dir`, once, from its domain (public: no keys); a table
// already in one of `cacheDirs` is copied
export const downloadTables = async (keys, dir, { cacheDirs = [] } = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  const missing = [];
  for (const key of keys) {
    const file = path.join(dir, fileName(key));
    if (fs.existsSync(file)) continue;
    const cached = cacheDirs
      .map((cache) => path.join(cache, fileName(key)))
      .find((other) => fs.existsSync(other));
    if (cached) fs.copyFileSync(cached, file);
    else missing.push(key);
  }
  for (const key of missing) {
    const url = bucketUrl(WAVETABLES_ORIGIN, key);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    fs.writeFileSync(path.join(dir, fileName(key)), Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${key}`);
  }
};
