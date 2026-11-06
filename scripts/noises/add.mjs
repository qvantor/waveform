// A sound of Freesound into assets/noises/manifest.json: its page has to say CC0, its original has to be in
// assets/noises/originals (downloading it needs a login: the script prints its link); the kind, unless
// given, is suggested by its envelope (a level within 10 dB of its median for 3 s at least: loop).
//   node scripts/noises/add.mjs <freesound sound url> --folder=<folder> [--name=<name>] [--kind=one-shot|attack|loop]
// Then: node scripts/noises/process.mjs --only=<id>, and listen to it in tmp/noises/index.html.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { suggestKind } from './dsp.mjs';
import { FOLDERS, KINDS, ORIGINALS, readManifest, writeManifest } from './manifest.mjs';
import { decode } from './wav.mjs';

const [url, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(
  rest.map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=')];
  })
);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!url?.startsWith('https://freesound.org/'))
  fail('usage: add.mjs <https://freesound.org/people/…/sounds/<id>/> --folder=<folder>');
if (!FOLDERS.includes(args.folder)) fail(`--folder: one of ${FOLDERS.join(', ')}`);
if (args.kind && !KINDS.includes(args.kind)) fail(`--kind: one of ${KINDS.join(', ')}`);

const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) chisper-noises' } });
if (!res.ok) fail(`${res.status} ${url}`);
const html = await res.text();
const page = res.url;
const [, author, id] = page.match(/\/people\/([^/]+)\/sounds\/(\d+)\//) ?? fail(`not a sound page: ${page}`);
const license = html.match(/creativecommons\.org\/(?:publicdomain|licenses)\/[^"'\s<]+/)?.[0];
if (!license?.startsWith('creativecommons.org/publicdomain/zero/')) fail(`${page}: not CC0 (${license})`);
const href =
  html.match(/href="(\/people\/[^"]+\/sounds\/\d+\/download\/[^"]+)"/)?.[1] ?? fail('no download link');
const file = decodeURIComponent(href.split('/').pop());

const manifest = readManifest();
if (manifest.sounds.some((s) => s.id === Number(id))) fail(`${id} is in the manifest already`);
const original = join(ORIGINALS, file);
if (!existsSync(original))
  fail(`download https://freesound.org${href} (logged in) into assets/noises/originals/, then again`);

const title = html.match(/<meta property="og:title" content="([^"]*) by [^"]*"/)?.[1] ?? file;
let name = args.name;
if (!name) {
  name = title
    .replace(/\.(wav|aiff?|flac|mp3|ogg|m4a)$/i, '')
    .replace(/_+/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  name = name.charAt(0).toUpperCase() + name.slice(1);
}
if (manifest.sounds.some((s) => s.folder === args.folder && s.name.toLowerCase() === name.toLowerCase()))
  fail(`${args.folder}/${name} is taken: --name=…`);

let kind = args.kind;
if (!kind) {
  const work = mkdtempSync(join(tmpdir(), 'noises-'));
  const { channels } = decode(original, join(work, 'decoded.wav'), manifest.defaults.rate);
  rmSync(work, { recursive: true, force: true });
  kind = suggestKind(channels, manifest.defaults.rate);
}

const sound = {
  id: Number(id),
  name,
  folder: args.folder,
  kind,
  file,
  sha256: createHash('sha256').update(readFileSync(original)).digest('hex'),
  author: decodeURIComponent(author),
  url: page,
  license: 'CC0-1.0',
};
writeManifest({ ...manifest, sounds: [...manifest.sounds, sound] });
console.log(JSON.stringify(sound, null, 2));
console.log(
  `${args.kind ? '' : `kind ${kind} suggested by the envelope; `}now: node scripts/noises/process.mjs --only=${id}`
);
