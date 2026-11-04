// The video of the first section of the promo page: the synth on the preset of the first clip playing four chords
// (its LFO moving both wave positions, ENV 2 the filter and the drive; the dots of the envelopes, the LFO and the
// velocity, the marks of the knobs, the spectrum and the meter of the header moving), recorded from the production
// site, looped where a chord follows the last one: the chord before the first is played before the recording, so its
// tail is there at the start as at the end. Into apps/site/public/video/synth.mp4 (H.264, the browsers of the
// systems play it) and synth.webm (VP9, for a Chromium without H.264), its first frame into
// apps/site/src/assets/synth-poster.png:
//   FFMPEG=<path of ffmpeg> npx -y -p playwright@1.50.1 node scripts/site/video.mjs [--url=https://chisper.qvantor.org]
// Chromium plays into a fake output of its own clock (as scripts/bench-perf/browser.mjs); the page is captured by
// the screencast of the DevTools protocol, sampled at FPS; the reports of listening (/api/usage) are blocked, so the
// recording counts for no preset.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPlaywright, parseArgs, root } from '../bench-common.mjs';
import { SITE, ffmpeg, openPreset, presetOf } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const URL_BASE = args.url ?? SITE;
// [AI] FX UFO Drone: envelopes sweep both wave positions through two spectral tables and the cutoff, an LFO
// (retriggered by every note, as they are: the loop closes on a chord) moves the cutoff
const PRESET = args.preset ?? presetOf('ufo-drone');
const VIEWPORT = { width: 1440, height: 900 };
const FPS = 30;
const WIDTH = 1280;
// seconds a chord is held
const CHORD = 2;
// the keys of the computer keyboard (Z = C3, Q = C4): G before the loop, then Am, F, C, G
const PREROLL = ['b', 'm', 'w'];
const CHORDS = [
  ['n', 'q', 'e'],
  ['v', 'n', 'q'],
  ['q', 'e', 't'],
  ['b', 'm', 'w'],
];
const OUT = args.out ?? path.join(root, 'apps/site/public/video');
const POSTER = args.poster ?? path.join(root, 'apps/site/src/assets/synth-poster.png');

const record = async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'],
  });
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.route('**/api/usage**', (route) => route.abort());
  await page.route('**/challenges.cloudflare.com/**', (route) => route.abort());
  await openPreset(page, URL_BASE, PRESET, VIEWPORT.width / 2);

  const frames = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, time: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });

  let held = [];
  const play = async (keys) => {
    for (const key of held) await page.keyboard.up(key);
    for (const key of keys) await page.keyboard.down(key);
    held = keys;
  };
  await play(PREROLL);
  await page.waitForTimeout(CHORD * 1000);
  const start = Date.now() / 1000;
  for (const chord of CHORDS) {
    await play(chord);
    await page.waitForTimeout(CHORD * 1000);
  }
  // the first chord again, past the end of the loop: the last frames are not of a release
  await play(CHORDS[0]);
  await page.waitForTimeout(300);
  await cdp.send('Page.stopScreencast');
  await play([]);
  await browser.close();
  return { frames, start };
};

// frames at FPS from the start of the loop for its length: each the latest frame the screencast had then
const sample = (frames, start) => {
  const length = CHORDS.length * CHORD;
  const sorted = [...frames].sort((a, b) => a.time - b.time);
  const picked = [];
  let next = 0;
  for (let i = 0; i < length * FPS; i++) {
    const time = start + i / FPS;
    while (next + 1 < sorted.length && sorted[next + 1].time <= time) next++;
    picked.push(sorted[next]);
  }
  return picked;
};

const main = async () => {
  const { frames, start } = await record();
  const picked = sample(frames, start);
  console.log(`${frames.length} frames captured, ${picked.length} in the loop`);
  const dir = mkdtempSync(path.join(tmpdir(), 'site-video-'));
  picked.forEach((frame, i) =>
    writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.jpg`), Buffer.from(frame.data, 'base64'))
  );
  mkdirSync(OUT, { recursive: true });
  const input = ['-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg')];
  const scale = ['-vf', `scale=${WIDTH}:-2:flags=lanczos`, '-an'];
  const vp9 = [
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '46',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '1',
  ];
  ffmpeg(...input, ...scale, ...vp9, '-g', String(FPS * 2), path.join(OUT, 'synth.webm'));
  ffmpeg(
    ...input,
    ...scale,
    '-c:v',
    'libx264',
    '-preset',
    'veryslow',
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(FPS * 2),
    '-movflags',
    '+faststart',
    path.join(OUT, 'synth.mp4')
  );
  ffmpeg('-i', path.join(OUT, 'synth.mp4'), '-frames:v', '1', path.join(dir, 'poster.png'));
  copyFileSync(path.join(dir, 'poster.png'), POSTER);
  rmSync(dir, { recursive: true, force: true });
  for (const name of ['synth.mp4', 'synth.webm'])
    console.log(`${name}: ${Math.round(statSync(path.join(OUT, name)).size / 1024)} KB`);
};

await main();
