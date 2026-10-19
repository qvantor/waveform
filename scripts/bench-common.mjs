// what the benchmarks of scripts/ share (bench-osc, bench-perf): the root of the repo and its require, the
// arguments, Playwright (not a dependency of the project: from `npx -p playwright`), the env of .env, the tables
// of the bucket
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
};

export const fileName = (key) => key.split('/').at(-1);

// the tables of the bucket (their S3 keys; BUCKET and the keys of .env) into `dir`, once: a table already in one
// of `cacheDirs` is copied
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
  if (!missing.length) return;
  readEnv();
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'eu-central-1',
    credentials: { accessKeyId: process.env.ACCESS_KEY_ID, secretAccessKey: process.env.SECRET_ACCESS_KEY },
  });
  for (const key of missing) {
    const { Body } = await client.send(new GetObjectCommand({ Bucket: process.env.BUCKET, Key: key }));
    fs.writeFileSync(path.join(dir, fileName(key)), Buffer.from(await Body.transformToByteArray()));
    console.log(`downloaded ${key}`);
  }
};
