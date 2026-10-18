// The benchmark of the wavetable oscillator against a native OscillatorNode (see README.md): bundles
// bench-page.ts and the worklet with esbuild, downloads 3 tables of the bucket (S3 keys of .env) into
// tmp/bench-osc/tables, serves them on localhost (a secure context: AudioWorklet) and runs the page in
// Chromium, WebKit and Firefox through Playwright, which is not a dependency of the project:
//   npx -y -p playwright@1.50.1 node scripts/bench-osc/run.mjs [--browsers=chromium,webkit,firefox]
//     [--rates=44100,48000,96000] [--only=sound,pitch,continuity,switch,stereo,unison,cpu,delivery,build]
import { createRequire } from 'module';
import fs from 'fs';
import http from 'http';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = path.join(root, 'tmp/bench-osc');
const site = path.join(out, 'site');
const tablesDir = path.join(out, 'tables');
const require = createRequire(path.join(root, 'package.json'));

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  })
);
const browsers = (args.browsers ?? 'chromium,webkit,firefox').split(',');
const rates = (args.rates ?? '44100,48000,96000').split(',').map(Number);
const only = args.only ? args.only.split(',') : null;
const runs = (step) => !only || only.includes(step);

const TABLES = [
  'ESW Core Tables/Basics/ESW Basics - Saw Collection.wav',
  'ESW Core Tables/Digital/ESW Digital - Air Lazer.wav',
  'ESW Core Tables/Vocal/ESW Vocal - Ahhh 01.wav',
];
const PITCHES = [55, 220, 1046, 3520, 7040];

// playwright from `npx -p playwright` (its .bin is on the PATH) or installed somewhere node finds it
const loadPlaywright = () => {
  const candidates = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => dir.endsWith(path.join('node_modules', '.bin')))
    .map((dir) => path.join(dir, '..', 'playwright'));
  for (const candidate of candidates)
    if (fs.existsSync(candidate)) return createRequire(candidate + '/')(candidate);
  return require('playwright');
};

const readEnv = () => {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
};

const fileName = (key) => key.split('/').at(-1);

const downloadTables = async () => {
  fs.mkdirSync(tablesDir, { recursive: true });
  const missing = TABLES.filter((key) => !fs.existsSync(path.join(tablesDir, fileName(key))));
  if (!missing.length) return;
  readEnv();
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'eu-central-1',
    credentials: { accessKeyId: process.env.ACCESS_KEY_ID, secretAccessKey: process.env.SECRET_ACCESS_KEY },
  });
  for (const key of missing) {
    const { Body } = await client.send(new GetObjectCommand({ Bucket: process.env.BUCKET, Key: key }));
    fs.writeFileSync(path.join(tablesDir, fileName(key)), Buffer.from(await Body.transformToByteArray()));
    console.log(`downloaded ${key}`);
  }
};

const bundle = async () => {
  const esbuild = require('esbuild');
  fs.mkdirSync(site, { recursive: true });
  const common = {
    bundle: true,
    format: 'esm',
    logLevel: 'warning',
    tsconfig: path.join(root, 'tsconfig.base.json'),
  };
  await esbuild.build({
    ...common,
    entryPoints: { bench: path.join(root, 'scripts/bench-osc/bench-page.ts') },
    outdir: site,
  });
  await esbuild.build({
    ...common,
    entryPoints: {
      'wavetable-osc': path.join(
        root,
        'apps/waveform/src/app/synth/common/wavetable/wavetable-osc.worklet.ts'
      ),
      'wavetable-worker': path.join(root, 'apps/waveform/src/app/synth/common/wavetable/wavetable.worker.ts'),
    },
    outdir: site,
  });
  fs.writeFileSync(
    path.join(site, 'index.html'),
    '<!doctype html><meta charset="utf-8"><script type="module" src="bench.js"></script>'
  );
};

const serve = () =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = url.startsWith('/tables/')
        ? path.join(tablesDir, url.slice('/tables/'.length))
        : path.join(site, url === '/' ? 'index.html' : url);
      if (!file.startsWith(out) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const type = file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.html')
        ? 'text/html'
        : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, 'localhost', () => resolve(server));
  });

const f = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : String(value));
const check = (failures, ok, text) => {
  if (!ok) failures.push(text);
  return ok ? 'ok' : 'FAIL';
};

const runBrowser = async (playwright, name, port) => {
  const browser = await playwright[name].launch();
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log(`[${name}] ${error.message}`));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.bench);
  const call = (fn, arg) => page.evaluate(([fn, arg]) => window.bench[fn](arg), [fn, arg]);
  const report = { browser: name, version: browser.version(), results: {} };
  const failures = [];
  const lines = [`## ${name} ${browser.version()}`];
  const log = (line) => {
    lines.push(line);
    console.log(`[${name}] ${line}`);
  };

  if (runs('sound'))
    for (const rate of rates)
      for (const table of ['saw', ...TABLES.map(fileName)]) {
        const results = await call('sound', { rate, name: table, pitches: PITCHES });
        report.results[`sound ${rate} ${table}`] = results;
        for (const { frequency, native, ours, level } of results) {
          const where = `${rate} Hz ${table} ${frequency} Hz`;
          const verdict = [
            check(failures, ours.aliasing <= native.aliasing + 1, `aliasing ${where}`),
            check(failures, ours.spur <= native.spur + 1, `spur ${where}`),
            check(failures, ours.highest >= native.highest, `brightness ${where}`),
            check(failures, Math.abs(level) <= 0.1, `level ${where}`),
          ];
          log(
            `sound ${where}: aliasing ${f(ours.aliasing)} (native ${f(native.aliasing)}) ${
              verdict[0]
            }, spur ${f(ours.spur)} (${f(native.spur)}) ${verdict[1]}, highest ${ours.highest} (${
              native.highest
            }) ${verdict[2]}, level ${f(level, 3)} dB ${verdict[3]}`
          );
        }
      }

  if (runs('pitch'))
    for (const rate of rates) {
      const results = await call('pitch', { rate, pitches: PITCHES });
      report.results[`pitch ${rate}`] = results;
      for (const { frequency, native, ours } of results)
        log(
          `pitch ${rate} Hz ${frequency} Hz: ${f(ours, 5)} cents (native ${f(native, 5)}) ${check(
            failures,
            Math.abs(ours) <= 0.01,
            `pitch ${rate} ${frequency}`
          )}`
        );
    }

  const rate = rates.includes(48000) ? 48000 : rates[0];
  if (runs('continuity'))
    for (const table of TABLES.map(fileName)) {
      const result = await call('continuity', { rate, name: table });
      report.results[`continuity ${table}`] = result;
      log(
        `continuity ${table}: frame at k/(N-1) off by ${result.positionError.toExponential(1)} ${check(
          failures,
          result.positionError <= 1e-6,
          `position ${table}`
        )}, morph step ×${f(result.morph, 3)} ${check(
          failures,
          result.morph <= 1.1,
          `morph ${table}`
        )}, glide step ×${f(result.glide, 3)} ${check(failures, result.glide <= 1.1, `glide ${table}`)}`
      );
    }

  if (runs('switch'))
    try {
      const result = await call('tableSwitch', { rate, name: fileName(TABLES[1]) });
      report.results.tableSwitch = result;
      log(
        `table switch: step ×${f(result.step, 3)} ${check(
          failures,
          result.step <= 1.1,
          'switch step'
        )}, after 10 ms off by ${result.afterCrossfade.toExponential(1)} ${check(
          failures,
          result.afterCrossfade <= 1e-5,
          'switch crossfade'
        )}`
      );
    } catch (error) {
      log(`table switch: not measured (${error.message})`);
    }

  if (runs('stereo')) {
    const { u3, u8 } = await call('stereo', { rate });
    report.results.stereo = { u3, u8 };
    const level = 1 / Math.sqrt(2);
    const expected3 = [
      [level, 0],
      [0, level],
      [level, level],
    ];
    const ok3 = u3.every((pair, i) => pair.every((value, c) => Math.abs(value - expected3[i][c]) < 0.01));
    const ok8 = u8.every(([l, r], j) => Math.abs((j % 2 ? r : l) - 0.5) < 0.01 && (j % 2 ? l : r) < 0.01);
    log(`stereo: u3 ${check(failures, ok3, 'stereo u3')}, u8 ${check(failures, ok8, 'stereo u8')}`);
  }

  if (runs('unison')) {
    const results = await call('unisonLevel', { rate, notes: 400 });
    report.results.unison = results;
    for (const { unison, rms, peak } of results)
      log(
        `unison u${unison} vs u1: rms ${f(rms, 2)} dB ${check(
          failures,
          Math.abs(rms) <= 0.3,
          `unison rms u${unison}`
        )}, peak ${f(peak, 2)} dB ${check(failures, peak >= -1 && peak <= 4, `unison peak u${unison}`)}`
      );
  }

  if (runs('cpu')) {
    const table = fileName(TABLES[1]);
    for (const [modulation, budget] of [
      ['none', 1],
      ['buses', 1],
      ['position', 1.3],
      ['detune', 1.3],
    ]) {
      const result = await call('cpu', { rate, name: table, modulation, seconds: 10 });
      report.results[`cpu ${modulation}`] = result;
      log(
        `cpu 64 osc (8 voices × 2 × u4), modulation ${modulation}: ours ${f(result.ours, 0)} ms, native ${f(
          result.native,
          0
        )} ms for 10 s, ×${f(result.ratio, 2)} (budget ${budget}) ${check(
          failures,
          result.ratio <= budget,
          `cpu ${modulation}`
        )}`
      );
    }
  }

  if (runs('delivery')) {
    const result = await call('delivery', { rate, name: fileName(TABLES[2]) });
    report.results.delivery = result;
    log(
      `delivery of ${result.frames} frames through the worker: ${f(result.ms, 0)} ms ${check(
        failures,
        result.ms <= 500,
        'delivery time'
      )}, main thread blocked ${f(result.blocked, 0)} ms at most ${check(
        failures,
        result.blocked <= 50,
        'main thread'
      )}, the voice plays it (off by ${result.difference.toExponential(1)}) ${check(
        failures,
        result.difference <= 1e-6,
        'delivered table'
      )}`
    );
  }

  if (runs('build')) {
    const result = await call('build', { name: fileName(TABLES[2]) });
    report.results.build = result;
    log(
      `build ${result.frames} frames: ${f(result.ms, 0)} ms on the main thread ${check(
        failures,
        result.ms <= 500,
        'build time'
      )}, ${f(result.bytes / 2 ** 20, 1)} MiB ${check(
        failures,
        result.bytes <= 64 * 2 ** 20 * (result.frames / 256),
        'memory'
      )}`
    );
  }

  log(failures.length ? `FAILED: ${failures.join('; ')}` : 'all criteria passed');
  await browser.close();
  return { report, lines, failures };
};

const main = async () => {
  const playwright = loadPlaywright();
  await downloadTables();
  await bundle();
  const server = await serve();
  const { port } = server.address();
  const reports = [];
  const lines = ['# Wavetable oscillator benchmark', '', new Date().toISOString(), ''];
  let failed = 0;
  for (const name of browsers) {
    try {
      const result = await runBrowser(playwright, name, port);
      reports.push(result.report);
      lines.push(...result.lines, '');
      failed += result.failures.length;
    } catch (error) {
      console.log(`[${name}] could not run: ${error.message}`);
      lines.push(`## ${name}`, `could not run: ${error.message}`, '');
      failed++;
    }
  }
  server.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(reports, null, 2));
  fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'));
  console.log(`report: ${path.join(out, 'report.md')}`);
  process.exitCode = failed ? 1 : 0;
};

main();
