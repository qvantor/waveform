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

export const readManifest = () => JSON.parse(readFileSync(join(NOISES, 'manifest.json'), 'utf8'));

// Sounds by folder (in FOLDERS order), then by name.
export function writeManifest(manifest) {
  const sounds = [...manifest.sounds].sort(
    (a, b) => FOLDERS.indexOf(a.folder) - FOLDERS.indexOf(b.folder) || a.name.localeCompare(b.name)
  );
  writeFileSync(join(NOISES, 'manifest.json'), JSON.stringify({ ...manifest, sounds }, null, 2) + '\n');
}
