// The noise samples from their originals (assets/noises/originals, Git LFS, not fetched by default:
// git lfs pull -I assets/noises/originals -X "") by assets/noises/manifest.json, into tmp/noises:
// <folder>/<name>.wav (float32, the rate of the manifest), report.json and index.html (each source with
// the part kept, and its result). macOS: afconvert decodes and resamples.
//   node scripts/noises/process.mjs [--only=id,id] [--out=tmp/noises]
//
// Manifest: `defaults` { rate, maxSeconds, attackMs, gapMs } and `sounds`, each { id, name, folder, kind }
// and either an original of Freesound { file, sha256, author, url, license } or `generate` (the type and
// params of a generator of generate.mjs, its id a name); its own maxSeconds, attackMs, gapMs (null: no
// silence splits it), highpass (Hz, 24 dB/oct: the rumble under a recording) or start/end (seconds of the
// original, cut before anything). kind: one-shot, attack (a kick's first attackMs) or loop (dsp.mjs).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { db, highpass, processSound } from './dsp.mjs';
import { GENERATORS, generate } from './generate.mjs';
import { KINDS, ORIGINALS, ROOT, readManifest } from './manifest.mjs';
import { decode, writeWav } from './wav.mjs';

const LFS_POINTER = 'version https://git-lfs.github.com/spec/v1';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const OUT = resolve(ROOT, args.out ?? 'tmp/noises');

const r1 = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Problems of a manifest and its originals: unknown kinds, names twice in a folder, missing files, LFS
// pointers (not pulled), other bytes than the sha256.
function check(manifest, sounds) {
  const problems = [];
  const names = new Set();
  let pointers = 0;
  for (const s of manifest.sounds) {
    const key = `${s.folder}/${s.name}`.toLowerCase();
    if (names.has(key)) problems.push(`${s.id}: ${s.folder}/${s.name} twice`);
    names.add(key);
  }
  for (const s of sounds) {
    if (!KINDS.includes(s.kind)) problems.push(`${s.id}: kind ${s.kind}`);
    if (s.generate) {
      if (!GENERATORS[s.generate.type]) problems.push(`${s.id}: no generator ${s.generate.type}`);
      continue;
    }
    const file = join(ORIGINALS, s.file);
    if (!existsSync(file)) {
      problems.push(`${s.id}: no ${relative(ROOT, file)}`);
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes.subarray(0, LFS_POINTER.length).toString() === LFS_POINTER) pointers++;
    else if (createHash('sha256').update(bytes).digest('hex') !== s.sha256)
      problems.push(`${s.id}: not the sha256 of ${s.file}`);
  }
  if (pointers)
    problems.push(`${pointers} originals are LFS pointers: git lfs pull -I assets/noises/originals -X ""`);
  return problems;
}

// Peaks per column of the source, the part kept green.
function waveSvg(chs, keep, width = 600, height = 48) {
  const n = chs[0].length;
  const cols = [];
  for (let x = 0; x < width; x++) {
    const a = Math.floor((x * n) / width);
    const b = Math.max(a + 1, Math.floor(((x + 1) * n) / width));
    let lo = 0;
    let hi = 0;
    for (const c of chs)
      for (let i = a; i < b && i < n; i++) {
        lo = Math.min(lo, c[i]);
        hi = Math.max(hi, c[i]);
      }
    cols.push([lo, hi]);
  }
  const peak = Math.max(1e-9, ...cols.map(([lo, hi]) => Math.max(-lo, hi)));
  const y = (v) => r1(height / 2 - (v / peak) * (height / 2 - 1));
  const d = cols.map(([lo, hi], x) => `M${x + 0.5} ${y(hi)}V${y(lo)}`).join('');
  const x0 = r1((keep[0] / n) * width);
  const x1 = r1((keep[1] / n) * width);
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="${x0}" width="${Math.max(1, x1 - x0)}" height="${height}" fill="#e3f1e6"/><path d="${d}" stroke="#333" stroke-width="1"/></svg>`;
}

function page(rows) {
  const tr = rows
    .map(
      (
        r
      ) => `<tr><td><b>${esc(r.file)}</b><br>${r.url ? `<a href="${esc(r.url)}" target="_blank">${esc(r.id)}</a> · ${esc(r.author)}` : `generated (${esc(r.id)})`} · ${r.kind}${r.highpass ? ` · highpass ${r.highpass} Hz` : ''}${r.parts > 1 ? ` · the first of ${r.parts} parts` : ''}${r.cap ? ` · ${r.kind === 'loop' ? 'a loop' : 'cut'} of ${r1(r.cap.from)} s` : ''}${r.mono ? ' · mono (L = R)' : ''}<br>
<span class="m">${r.before} → ${r.after} s · from ${r.start} to ${r.end} ms of the source · fade in ${r.fadeIn} / out ${r.fadeOut} ms · ${r.gainDb >= 0 ? '+' : ''}${r.gainDb} dB · RMS ${r.rmsDb} dB · source ${r.sourceRate / 1000} kHz</span></td>
<td>${r.svg}<br><audio controls preload="none" src="${encodeURI(r.file)}"></audio></td></tr>`
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Noise samples</title>
<style>body{font:13px/1.4 -apple-system,system-ui,sans-serif;margin:16px;color:#222}table{border-collapse:collapse}td{border-top:1px solid #ddd;padding:6px 10px;vertical-align:top}.m{color:#666;font-size:12px}audio{width:600px;height:32px}</style>
<h1>Noise samples (${rows.length})</h1><p class="m">The source, the part kept green; the player plays the result.</p>
<table>${tr}</table>`;
}

function main() {
  const manifest = readManifest();
  const { rate, ...defaults } = manifest.defaults;
  const sounds = manifest.sounds.filter((s) => !ONLY || ONLY.has(String(s.id)));
  const problems = check(manifest, sounds);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  const work = mkdtempSync(join(tmpdir(), 'noises-'));
  if (!ONLY) rmSync(OUT, { recursive: true, force: true });
  const rows = [];
  for (const s of sounds) {
    const src = s.generate
      ? { channels: generate(s.generate, rate), sourceRate: rate }
      : decode(join(ORIGINALS, s.file), join(work, 'decoded.wav'), rate);
    const a = s.start != null ? Math.round(s.start * rate) : 0;
    const b = s.end != null ? Math.round(s.end * rate) : src.channels[0].length;
    let channels = src.channels.map((c) => c.slice(a, b));
    if (s.highpass) channels = highpass(channels, rate, s.highpass);
    const opts = {
      ...defaults,
      ...Object.fromEntries(['maxSeconds', 'attackMs', 'gapMs'].filter((k) => k in s).map((k) => [k, s[k]])),
    };
    const t = processSound(channels, rate, { ...opts, kind: s.kind });
    const file = `${s.folder}/${s.name}.wav`;
    mkdirSync(dirname(join(OUT, file)), { recursive: true });
    writeWav(join(OUT, file), rate, t.out);
    let sq = 0;
    for (const c of t.out) for (const v of c) sq += v * v;
    const ms = (v) => r1((v / rate) * 1000);
    const row = {
      file,
      id: s.id,
      url: s.url,
      author: s.author,
      highpass: s.highpass,
      kind: s.kind,
      sourceRate: src.sourceRate,
      mono: t.mono,
      channels: t.out.length,
      parts: t.parts,
      cap: t.cap,
      before: Math.round((channels[0].length / rate) * 1000) / 1000,
      after: Math.round((t.out[0].length / rate) * 1000) / 1000,
      start: ms(a + t.start),
      end: ms(a + t.end),
      fadeIn: ms(t.fadeIn),
      fadeOut: ms(t.fadeOut),
      gainDb: r1(db(t.gain)),
      rmsDb: r1(db(Math.sqrt(sq / (t.out[0].length * t.out.length)))),
    };
    rows.push({ ...row, svg: waveSvg(t.mixed, [t.start, t.end]) });
    console.log(
      [
        s.id,
        s.kind.padEnd(8),
        `${row.before}→${row.after} s`.padEnd(16),
        `${row.gainDb >= 0 ? '+' : ''}${row.gainDb} dB`.padEnd(9),
        t.parts > 1 ? `first of ${t.parts}` : '',
        t.cap ? `${s.kind === 'loop' ? 'loop' : 'cut'} of ${r1(t.cap.from)} s` : '',
        file,
      ]
        .filter(Boolean)
        .join('  ')
    );
  }
  rmSync(work, { recursive: true, force: true });
  writeFileSync(
    join(OUT, 'report.json'),
    JSON.stringify(
      rows.map(({ svg, ...r }) => r),
      null,
      2
    )
  );
  writeFileSync(join(OUT, 'index.html'), page(rows));
  console.log(`${rows.length} → ${relative(ROOT, OUT)}`);
}

main();
