// assets/noises/manifest.json: the noise samples, their originals and how each is processed (process.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const NOISES = join(ROOT, 'assets/noises');
export const ORIGINALS = join(NOISES, 'originals');
export const KINDS = ['one-shot', 'attack', 'loop'];
// The folders in their order: a new sound goes into one of them.
export const FOLDERS = [
  'Analog',
  'Kick Attacks',
  'Transients',
  'Inharmonic',
  'Organic',
  'Textures',
  'Atmospheres',
];
// The order of the samples in the synth, next to them and in the bucket (netlify/functions/get-noises-list).
export const ORDER_FILE = 'order.json';

export const readManifest = () => JSON.parse(readFileSync(join(NOISES, 'manifest.json'), 'utf8'));

// The key of a sample in the bucket, its file under tmp/noises.
export const sampleKey = (sound) => `${sound.folder}/${sound.name}.wav`;

// Sounds by folder (in FOLDERS order), those of a folder in the order of the list: the basic ones first.
export const sortSounds = (sounds) =>
  [...sounds].sort((a, b) => FOLDERS.indexOf(a.folder) - FOLDERS.indexOf(b.folder));

// The keys of the samples in the order of the synth.
export const sampleOrder = (manifest) => sortSounds(manifest.sounds).map(sampleKey);

// A new sound goes last in its folder.
export function writeManifest(manifest) {
  writeFileSync(
    join(NOISES, 'manifest.json'),
    JSON.stringify({ ...manifest, sounds: sortSounds(manifest.sounds) }, null, 2) + '\n'
  );
}
