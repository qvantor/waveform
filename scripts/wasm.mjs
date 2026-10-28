// `npm run wasm`: the Rust cores of the worklets (dsp/) into tmp/wasm/<name>.wasm, and with the counters of the
// perf build (the cargo feature `perf`, as __PERF__) into tmp/wasm-perf/<name>.wasm (`build:perf` and the specs).
// cargo builds them (dsp/rust-toolchain.toml: the toolchain and wasm32-unknown-unknown), wasm-opt -O3 of binaryen
// (a devDependency) shrinks them, never with fast-math: the bits stay those of the TS cores.
// --only=prod builds tmp/wasm alone (build, client:start), --only=perf tmp/wasm-perf alone (build:perf, the specs);
// --sizes prints their gzip sizes, --check-sizes fails over the budget of a module (CI), --watch builds them
// again on every change of dsp/ (client:start)
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DSP = 'dsp';
const OUT = 'tmp/wasm';
const OUT_PERF = 'tmp/wasm-perf';
// the cores: crate, its bundle (the worklet bundle of the same name embeds it), the gzip budget (bytes, about 10%
// over the size of the port: dlmalloc, the tables of jsmath and the fmt the panic sites still reference are ~12 KB)
const CORES = [
  { crate: 'limiter', name: 'limiter', budget: 15500 },
  { crate: 'reverb', name: 'reverb', budget: 25500 },
  { crate: 'distortion', name: 'distortion', budget: 25500 },
  // (the voices of one node: their timelines and their scope, +5.8 KB; the fades of a frame, +1.3 KB; the LFOs and
  // the routes of their knobs, +6.3 KB)
  { crate: 'wavetable-osc', name: 'wavetable-osc', budget: 66000 },
  // jsmath exported to the specs (not bundled)
  { crate: 'jsmath-check', name: 'jsmath-check', budget: null },
];

const args = process.argv.slice(2);
const require = createRequire(import.meta.url);
const wasmOpt = join(dirname(require.resolve('binaryen/package.json')), 'bin', 'wasm-opt');

const run = (command, commandArgs, options = {}) => {
  const { status, error } = spawnSync(command, commandArgs, { stdio: 'inherit', ...options });
  if (error)
    throw new Error(`${command}: ${error.message}${error.code === 'ENOENT' ? ' (is it installed?)' : ''}`);
  if (status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed (${status})`);
};

const artifact = (targetDir, crate) =>
  join(DSP, targetDir, 'wasm32-unknown-unknown', 'release', `${crate.replace(/-/g, '_')}.wasm`);

const cargo = (perf) => {
  const packages = CORES.flatMap(({ crate }) => ['-p', crate]);
  const features = perf
    ? [
        '--features',
        CORES.filter((c) => c.budget)
          .map((c) => `${c.crate}/perf`)
          .join(','),
      ]
    : [];
  const targetDir = perf ? 'target/perf' : 'target';
  run(
    'cargo',
    [
      'build',
      '--release',
      '--target',
      'wasm32-unknown-unknown',
      '--target-dir',
      targetDir,
      ...packages,
      ...features,
    ],
    // in dsp/: rustup reads the toolchain of dsp/rust-toolchain.toml from the working directory
    { cwd: DSP }
  );
  return targetDir;
};

const optimize = (from, to) => {
  // the features of the module from its target_features section; -O3, no --fast-math
  run(wasmOpt, [from, '-O3', '--detect-features', '-o', to]);
};

const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
const VARIANTS = [
  [false, OUT],
  [true, OUT_PERF],
].filter(([perf]) => !only || only === (perf ? 'perf' : 'prod'));

const build = () => {
  const started = Date.now();
  for (const [perf, out] of VARIANTS) {
    const targetDir = cargo(perf);
    mkdirSync(out, { recursive: true });
    for (const { crate, name } of CORES) {
      const from = artifact(targetDir, crate);
      if (crate === 'jsmath-check') copyFileSync(from, join(out, `${name}.wasm`));
      else optimize(from, join(out, `${name}.wasm`));
    }
  }
  const into = VARIANTS.map(([, out]) => out).join(' and ');
  console.log(`wasm: ${CORES.length} cores into ${into} in ${Date.now() - started} ms`);
};

const sizes = (check) => {
  let over = false;
  for (const { name, budget } of CORES) {
    if (budget === null) continue;
    const file = join(OUT, `${name}.wasm`);
    if (!existsSync(file)) throw new Error(`${file} is missing: run \`npm run wasm\``);
    const bytes = readFileSync(file);
    const gzip = gzipSync(bytes, { level: 9 }).length;
    const fits = gzip <= budget;
    over ||= !fits;
    console.log(`${name}.wasm: ${bytes.length} bytes, ${gzip} gzip (budget ${budget})${fits ? '' : ' OVER'}`);
  }
  if (check && over) {
    console.error('a wasm core is over its gzip budget (scripts/wasm.mjs)');
    process.exit(1);
  }
};

if (args.includes('--sizes') || args.includes('--check-sizes')) sizes(args.includes('--check-sizes'));
else {
  build();
  if (args.includes('--watch')) {
    let timer = null;
    watch(DSP, { recursive: true }, (_, file) => {
      if (!file || file.startsWith('target')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          build();
        } catch (error) {
          console.error(error.message);
        }
      }, 200);
    });
  }
}
