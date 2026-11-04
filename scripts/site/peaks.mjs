// The peaks and the length of every clip of the promo page (apps/site/public/demos/*.mp3) into
// apps/site/src/data/peaks.json, the waves its players draw. Run it once a clip is added or recorded again:
//   FFMPEG=<path of ffmpeg> node scripts/site/peaks.mjs
// (ffmpeg on the PATH by default) decodes each clip as the browser plays it (stereo, 48 kHz, f32) and takes the
// largest |sample| of both channels in each of PEAKS bins, scaled to the loudest bin of the clip.
import { readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ffmpeg } from './common.mjs';

const ROOT = join(import.meta.dirname, '../..');
const DEMOS = join(ROOT, 'apps/site/public/demos');
const OUT = join(ROOT, 'apps/site/src/data/peaks.json');
const RATE = 48000;
export const PEAKS = 200;

const decode = (file) => {
  const bytes = ffmpeg('-i', file, '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-');
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};

// the largest |sample| of each bin (both channels interleaved), then scaled so the largest is 1
export const peaksOf = (samples, count = PEAKS) => {
  const frames = samples.length / 2;
  const peaks = new Array(count).fill(0);
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * frames) / count) * 2;
    const to = Math.floor(((i + 1) * frames) / count) * 2;
    for (let j = from; j < to; j++) peaks[i] = Math.max(peaks[i], Math.abs(samples[j]));
  }
  const top = Math.max(...peaks) || 1;
  return peaks.map((peak) => Math.round((peak / top) * 100) / 100);
};

const main = () => {
  const clips = readdirSync(DEMOS)
    .filter((name) => name.endsWith('.mp3'))
    .sort();
  const lines = clips.map((name) => {
    const samples = decode(join(DEMOS, name));
    const duration = Math.round((samples.length / 2 / RATE) * 10) / 10;
    const entry = { duration, peaks: peaksOf(samples) };
    console.log(`${name}: ${duration} s`);
    return `  ${JSON.stringify(basename(name, '.mp3'))}: ${JSON.stringify(entry)}`;
  });
  writeFileSync(OUT, `{\n${lines.join(',\n')}\n}\n`);
};

if (process.argv[1] === import.meta.filename) main();
