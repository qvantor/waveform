// The benchmark of the wavetable oscillator against a native OscillatorNode (see README.md): bundles
// bench-page.ts and the worklet with esbuild, downloads 3 tables of the bucket (S3 keys of .env) into
// tmp/bench-osc/tables, serves them on localhost (a secure context: AudioWorklet) and runs the page in
// Chromium, WebKit and Firefox through Playwright, which is not a dependency of the project:
//   npx -y -p playwright@1.50.1 node scripts/bench-osc/run.mjs [--browsers=chromium,webkit,firefox]
//     [--rates=44100,48000,96000] [--only=sound,pitch,continuity,switch,stereo,unison,cpu,biquad,delivery,build]
//     [--dsp=js]
// The worklet is the one of production, on the wasm core (tmp/wasm: `npm run wasm` first); --dsp=js the TS one
import fs from 'fs';
import http from 'http';
import path from 'path';
import { downloadTables, fileName, loadPlaywright, parseArgs, require, root } from '../bench-common.mjs';

const out = path.join(root, 'tmp/bench-osc');
const site = path.join(out, 'site');
const tablesDir = path.join(out, 'tables');

const args = parseArgs(process.argv.slice(2));
const browsers = (args.browsers ?? 'chromium,webkit,firefox').split(',');
const rates = (args.rates ?? '44100,48000,96000').split(',').map(Number);
const only = args.only ? args.only.split(',') : null;
const runs = (step) => !only || only.includes(step);
const dsp = args.dsp === 'js' ? 'js' : 'wasm';

const TABLES = [
  'ESW Core Tables/Basics/ESW Basics - Saw Collection.wav',
  'ESW Core Tables/Digital/ESW Digital - Air Lazer.wav',
  'ESW Core Tables/Vocal/ESW Vocal - Ahhh 01.wav',
];
const PITCHES = [55, 220, 1046, 3520, 7040];

const bundle = async () => {
  const esbuild = require('esbuild');
  fs.mkdirSync(site, { recursive: true });
  const common = {
    bundle: true,
    format: 'esm',
    logLevel: 'warning',
    tsconfig: path.join(root, 'tsconfig.base.json'),
    // the code of the perf build out, as in production (apps/waveform/src/globals.d.ts)
    define: { __PERF__: 'false' },
  };
  await esbuild.build({
    ...common,
    entryPoints: { bench: path.join(root, 'scripts/bench-osc/bench-page.ts') },
    outdir: site,
  });
  if (dsp === 'wasm' && !fs.existsSync(path.join(root, 'tmp/wasm/wavetable-osc.wasm')))
    throw new Error('tmp/wasm/wavetable-osc.wasm is missing: run `npm run wasm` first');
  await esbuild.build({
    ...common,
    // the bytes of the core inlined, as `npm run worklets` does
    loader: { '.wasm': 'binary' },
    supported: { 'from-base64': false },
    entryPoints: {
      'wavetable-osc': path.join(
        root,
        `apps/waveform/src/app/synth/common/wavetable/wavetable-osc${
          dsp === 'wasm' ? '.wasm' : ''
        }.worklet.ts`
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
  try {
    return await runPages(browser, name, port);
  } finally {
    await browser.close();
  }
};

const runPages = async (browser, name, port) => {
  let page = null;
  // a page of its own for every call: the contexts of the last one go with it (each holds its worklet, a wasm
  // core with a table of up to 64 MB in its memory; Chromium stopped making new ones within a page)
  const call = async (fn, arg) => {
    await page?.close();
    page = await browser.newPage();
    page.on('pageerror', (error) => console.log(`[${name}] ${error.message}`));
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.bench);
    return page.evaluate(([fn, arg]) => window.bench[fn](arg), [fn, arg]);
  };
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
    // the lowest voice left, the middle one of an odd count both channels, the highest right; each at
    // 1/√⌈n/2⌉
    const level = 1 / Math.sqrt(2);
    const expected3 = [
      [level, 0],
      [level, level],
      [0, level],
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
    // ENV 2 on its sustain costs what the same sound does without routes (the mix tables: its budget, that run
    // of ours, still-sustain); moving, it costs what an LFO on the same params does, without the inputs of the
    // AudioParams (its budget: that run of ours)
    for (const [modulation, budget] of [
      ['none', 1],
      ['buses', 1],
      ['position', 1.3],
      ['detune', 1.3],
      ['still-sustain', 1],
      ['env-sustain', 'still-sustain'],
      ['lfo-wdg', 2],
      ['env-moving', 'lfo-wdg'],
    ]) {
      const result = await call('cpu', { rate, name: table, modulation, seconds: 10 });
      report.results[`cpu ${modulation}`] = result;
      const against = typeof budget === 'string' ? report.results[`cpu ${budget}`] : null;
      const ok = against ? result.ours <= against.ours * 1.05 : result.ratio <= budget;
      log(
        `cpu 64 osc (8 voices × 2 × u4), modulation ${modulation}: ours ${f(result.ours, 0)} ms, native ${f(
          result.native,
          0
        )} ms for 10 s, ×${f(result.ratio, 2)} (budget ${
          against ? `ours with ${budget}: ${f(against.ours, 0)} ms` : budget
        }) ${check(failures, ok, `cpu ${modulation}`)}`
      );
    }
  }

  // the delay's bandpass under the automation of ENV 2: a-rate may work its coefficients out every sample;
  // k-rate (once per block) is used if a-rate costs more than twice the still filter
  if (runs('biquad')) {
    const { still, aRate, kRate } = await call('biquadAutomation', { rate, seconds: 10 });
    report.results.biquad = { still, aRate, kRate };
    log(
      `delay bandpass ×2, 10 s: still ${f(still, 0)} ms, a-rate ramps ${f(aRate, 0)} ms (×${f(
        aRate / still,
        2
      )}), k-rate ramps ${f(kRate, 0)} ms (×${f(kRate / still, 2)})`
    );
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
  return { report, lines, failures };
};

const main = async () => {
  const playwright = loadPlaywright();
  await downloadTables(TABLES, tablesDir);
  await bundle();
  const server = await serve();
  const { port } = server.address();
  const reports = [];
  const lines = [`# Wavetable oscillator benchmark (the ${dsp} core)`, '', new Date().toISOString(), ''];
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
