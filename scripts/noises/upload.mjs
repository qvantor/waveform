// The samples of the noise oscillator (tmp/noises/<folder>/<name>.wav, made by scripts/noises/process.mjs) into the
// noise bucket of the site as <folder>/<name>.wav (R2: R2_NOISES_BUCKET and the R2_* of .env;
// netlify/functions/get-noises-list lists them, the folders are the categories): a file the bucket hasn't or has
// other bytes of (its md5 against the ETag) is put, with --delete a sample gone from the folder is removed. A dry
// run (what it would do) unless --apply: it writes to the bucket the site plays from.
//   node scripts/noises/upload.mjs [--from=tmp/noises] [--delete] [--apply]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { siteBucket } from '../bench-common.mjs';

const require = createRequire(import.meta.url);
const { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');

const root = new URL('../..', import.meta.url).pathname;
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  })
);
const from = resolve(root, args.from ?? 'tmp/noises');
const apply = args.apply === true;

const { client, Bucket } = siteBucket('R2_NOISES_BUCKET');

// the samples of the folder: their key in the bucket and their file
const local = new Map();
const walk = (dir) =>
  readdirSync(dir).forEach((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.wav')) local.set(relative(from, path).split('\\').join('/'), path);
  });
walk(from);
if (local.size === 0)
  throw new Error(`no samples in ${relative(root, from)}: node scripts/noises/process.mjs`);

// the samples in the bucket: their key and ETag (the md5 of a file put whole)
const remote = new Map();
let token;
do {
  const page = await client.send(new ListObjectsV2Command({ Bucket, ContinuationToken: token }));
  (page.Contents ?? []).forEach(({ Key, ETag }) => remote.set(Key, ETag?.replace(/"/g, '')));
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

const puts = [...local].filter(
  ([key, path]) => remote.get(key) !== createHash('md5').update(readFileSync(path)).digest('hex')
);
const deletes = args.delete ? [...remote.keys()].filter((key) => !local.has(key) && !key.endsWith('/')) : [];
puts.forEach(([key]) => console.log(`${remote.has(key) ? 'update' : 'put'} ${key}`));
deletes.forEach((key) => console.log(`delete ${key}`));
const gone = [...remote.keys()].filter((key) => !local.has(key) && !key.endsWith('/'));
if (!args.delete && gone.length)
  console.log(`${gone.length} samples of the bucket are gone here (--delete removes them)`);
console.log(
  `${local.size} samples here, ${remote.size} in the bucket: ${puts.length} to put, ${deletes.length} to delete`
);
if (!apply) {
  console.log('a dry run: --apply writes them');
  process.exit(0);
}
for (const [key, path] of puts)
  await client.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: readFileSync(path),
      ContentType: 'audio/wav',
    })
  );
for (let i = 0; i < deletes.length; i += 1000)
  await client.send(
    new DeleteObjectsCommand({
      Bucket,
      Delete: { Objects: deletes.slice(i, i + 1000).map((Key) => ({ Key })) },
    })
  );
console.log('done');
