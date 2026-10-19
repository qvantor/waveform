// shared helpers of the perf suite (README.md): paths, arguments, statistics, processes, the machine
import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { require, root } from '../bench-common.mjs';

export { loadPlaywright, parseArgs, require, root } from '../bench-common.mjs';
export const out = path.join(root, 'tmp/bench-perf');
export const tablesDir = path.join(out, 'tables');
export const tracesDir = path.join(out, 'traces');
export const siteDir = path.join(root, 'dist/apps/waveform-perf');
export const here = path.join(root, 'scripts/bench-perf');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// the rate of the context of every case: the app asks for none, its context would run at the rate of the output
// device (an interface at 96 kHz: about twice the cycles)
export const SCENE_RATE = 48000;

// --- statistics ---

const finite = (values) => values.filter((value) => Number.isFinite(value));
export const median = (values) => percentile(values, 50);
export const percentile = (values, p) => {
  const sorted = finite(values).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (p / 100) * (sorted.length - 1);
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (at - low);
};
export const mean = (values) => {
  const all = finite(values);
  return all.length ? all.reduce((sum, value) => sum + value, 0) / all.length : null;
};
// coefficient of variation (stddev / mean), 0 for fewer than 2 values
export const cv = (values) => {
  const all = finite(values);
  const average = mean(all);
  if (all.length < 2 || !average) return 0;
  const variance = all.reduce((sum, value) => sum + (value - average) ** 2, 0) / (all.length - 1);
  return Math.sqrt(variance) / Math.abs(average);
};
// 4 significant digits (the baseline files)
export const round4 = (value) => (Number.isFinite(value) ? Number(value.toPrecision(4)) : value);
export const fixed = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '–');

// --- processes ---

export const exec = (command, args, options = {}) =>
  new Promise((resolve, reject) =>
    execFile(command, args, { maxBuffer: 2 ** 31 - 1, ...options }, (error, stdout, stderr) =>
      error ? reject(Object.assign(error, { stdout, stderr })) : resolve(stdout)
    )
  );
export const tryExec = (command, args, options) => exec(command, args, options).catch(() => '');

// the Mac doesn't sleep while the suite runs (headed browsers need the display)
export const keepAwake = () => {
  const child = spawn('caffeinate', ['-dis', '-w', String(process.pid)], { stdio: 'ignore' });
  child.on('error', () => undefined);
  return () => child.kill();
};

// --- the code of the app in Node ---

// bundles modules of the app (`contents`: an entry of exports, paths from the root of `source`, the repo or the
// worktree of a reference) for Node, imports the bundle; `__PERF__` as the code is meant to run
export const loadApp = async ({ source = root, contents, name, perf = false }) => {
  const esbuild = require('esbuild');
  const outfile = path.join(out, 'node', `${name}.mjs`);
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    stdin: { contents, resolveDir: source, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'warning',
    tsconfig: path.join(source, 'tsconfig.base.json'),
    define: { __PERF__: String(perf) },
    outfile,
  });
  return import(`${outfile}?${Date.now()}`);
};

// --- the machine and the code ---

const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const machine = async () => {
  const [model, cpu, memory, os] = await Promise.all([
    tryExec('sysctl', ['-n', 'hw.model']),
    tryExec('sysctl', ['-n', 'machdep.cpu.brand_string']),
    tryExec('sysctl', ['-n', 'hw.memsize']),
    tryExec('sw_vers', ['-productVersion']),
  ]);
  const result = {
    model: model.trim() || process.platform,
    cpu: cpu.trim() || 'unknown',
    memGB: Math.round(Number(memory) / 2 ** 30) || null,
    os: os.trim() || process.platform,
  };
  return { ...result, key: slug(`${result.model}-${result.cpu}`) };
};

export const git = async () => {
  const commit = (await tryExec('git', ['rev-parse', '--short', 'HEAD'], { cwd: root })).trim();
  const dirty = (await tryExec('git', ['status', '--porcelain'], { cwd: root })).trim() !== '';
  return { commit, dirty };
};

// a hash of what a build of the app is made of: the commit, the changes of the app and the libs (tracked and
// not), the dependencies
export const sourceStamp = async () => {
  const hash = crypto.createHash('sha1');
  hash.update(await tryExec('git', ['rev-parse', 'HEAD'], { cwd: root }));
  hash.update(
    await tryExec('git', ['diff', 'HEAD', '--', 'apps', 'libs', 'package.json', 'package-lock.json'], {
      cwd: root,
    })
  );
  const untracked = (
    await tryExec('git', ['ls-files', '--others', '--exclude-standard', 'apps', 'libs'], { cwd: root })
  )
    .split('\n')
    .filter(Boolean);
  for (const file of untracked) hash.update(file).update(fs.readFileSync(path.join(root, file)));
  return hash.digest('hex');
};

// what may skew a run: battery, Low Power Mode, a Bluetooth output (its latency), an output at another rate than
// the cases (the browser resamples them), xctrace missing
export const preflight = async () => {
  const issues = [];
  const battery = await tryExec('pmset', ['-g', 'batt']);
  if (battery && !battery.includes('AC Power')) issues.push('on battery: connect the power adapter');
  const settings = await tryExec('pmset', ['-g']);
  if (/lowpowermode\s+1/.test(settings)) issues.push('Low Power Mode is on');
  const audio = await tryExec('system_profiler', ['SPAudioDataType', '-json'], { timeout: 15000 });
  let output = null;
  try {
    const devices = JSON.parse(audio).SPAudioDataType?.[0]?._items ?? [];
    const device = devices.find((item) => item.coreaudio_default_audio_output_device === 'spaudio_yes');
    output = device
      ? {
          name: device._name,
          transport: device.coreaudio_device_transport ?? null,
          rate: device.coreaudio_device_srate ?? null,
        }
      : null;
  } catch {
    output = null;
  }
  if (output?.transport?.includes('bluetooth'))
    issues.push(`the output is Bluetooth (${output.name}): latency is off`);
  if (output?.rate && output.rate !== SCENE_RATE)
    issues.push(
      `the output runs at ${output.rate} Hz, the cases at ${SCENE_RATE}: the browser resamples them (more cycles ` +
        'and latency than the baseline): set the output to 48 kHz in Audio MIDI Setup'
    );
  if (!(await tryExec('xcrun', ['--find', 'xctrace'])).trim())
    issues.push('xctrace not found: install Xcode');
  return { issues, output };
};
