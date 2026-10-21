// the reference of an A/B run (--against=<ref>): that commit checked out in a worktree of its own
// (tmp/bench-perf/against/<sha>, gitignored), its dependencies those of the repo (node_modules linked), its
// perf build, built once. The runs of the reference and of the working tree alternate in one session, so the
// drift of a session (the JIT, the cores the threads land on, the heat) weighs on both sides alike
import fs from 'fs';
import path from 'path';
import { exec, out, root, tryExec } from './util.mjs';

const BUILD = 'dist/apps/waveform-perf';
const STAMP = 'perf-build-stamp.txt';
const WASM_STAMP = 'wasm-stamp.txt';

// `build`: its perf build too (the browser cases; the DSP bundles its sources)
export const prepareReference = async (ref, { build = true } = {}) => {
  const sha = (
    await exec('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root }).catch(() => '')
  ).trim();
  if (!sha) throw new Error(`--against=${ref}: no such commit`);
  const short = sha.slice(0, 7);
  const dir = path.join(out, 'against', short);
  const notes = [];
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    await tryExec('git', ['worktree', 'prune'], { cwd: root });
    console.log(`against ${ref}: checking out ${short} in ${path.relative(root, dir)}…`);
    await exec('git', ['worktree', 'add', '--detach', '--force', dir, sha], { cwd: root });
  }
  // a commit before the test hook can't be driven
  if (!fs.existsSync(path.join(dir, 'apps/waveform/src/app/perf/perf-api.ts')))
    throw new Error(`--against=${ref}: ${short} has no perf build (apps/waveform/src/app/perf, a813450 on)`);
  const modules = path.join(dir, 'node_modules');
  if (!fs.existsSync(modules)) fs.symlinkSync(path.join(root, 'node_modules'), modules, 'dir');
  const lock = (folder) => fs.readFileSync(path.join(folder, 'package-lock.json'), 'utf8');
  if (lock(dir) !== lock(root))
    notes.push(
      `the reference ${short} has other dependencies (package-lock.json): built with those of the repo`
    );

  const siteDir = path.join(dir, BUILD);
  const stamp = path.join(dir, STAMP);
  const built = fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === sha;
  if (build && (!built || !fs.existsSync(path.join(siteDir, 'index.html')))) {
    console.log(`against ${ref}: the perf build of ${short} (npm run build:perf)…`);
    // its own Nx caches: the node_modules (and the caches in it) are the repo's
    await exec('npm', ['run', 'build:perf'], {
      cwd: dir,
      env: {
        ...process.env,
        NX_DAEMON: 'false',
        NX_CACHE_DIRECTORY: path.join(dir, 'tmp/nx-cache'),
        NX_PROJECT_GRAPH_CACHE_DIRECTORY: path.join(dir, 'tmp/nx-graph'),
      },
    });
    fs.writeFileSync(stamp, sha);
  }
  // the cores of a tree with Rust ones (scripts/wasm.mjs): the DSP runs those of production (tmp/wasm), which
  // the perf build doesn't make
  const wasmStamp = path.join(dir, WASM_STAMP);
  const wasmBuilt = fs.existsSync(wasmStamp) && fs.readFileSync(wasmStamp, 'utf8') === sha;
  if (fs.existsSync(path.join(dir, 'scripts/wasm.mjs')) && !wasmBuilt) {
    console.log(`against ${ref}: the wasm cores of ${short} (npm run wasm)…`);
    await exec('npm', ['run', 'wasm', '--', '--only=prod'], { cwd: dir });
    fs.writeFileSync(wasmStamp, sha);
  }
  return { ref, sha, short, dir, siteDir, notes };
};
