import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Signal } from './fuzz-signals';

// the golden hashes of the scenarios of each wasm core (dsp/goldens/<module>.json): the bits of every output
// sample, block by block; `UPDATE_GOLDENS=1` writes them again (a change of the sound is an explicit update of its
// hashes). Fuzzing: FUZZ_SCALE multiplies the random scenarios of each spec (1 on a PR, the nightly run takes
// 250), which must stay finite and keep the properties of its core. expectSameBits compares two renders of a core
// (a worklet and its core in Node)

export const FUZZ_SCALE = Number(process.env['FUZZ_SCALE'] ?? 1);

const bits = new DataView(new ArrayBuffer(4));
export const f32Bits = (value: number) => {
  bits.setFloat32(0, value);
  return `0x${bits.getUint32(0).toString(16).padStart(8, '0')}`;
};

// the first sample whose bits differ, -1: none (two NaNs differ as well: a NaN never reaches an output)
export const firstMismatch = (a: Float32Array, b: Float32Array) => {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i] || Number.isNaN(a[i])) return i;
  return -1;
};

// fails with where the outputs of the cores part (the scenario, its block and sample, both values and their bits)
export const expectSameBits = (
  scenario: string,
  block: number,
  channel: string,
  ts: Float32Array,
  wasm: Float32Array
) => {
  const at = firstMismatch(ts, wasm);
  if (at < 0) return;
  throw new Error(
    `${scenario}: block ${block}, ${channel}[${at}]: ts ${ts[at]} (${f32Bits(ts[at])}) ≠ wasm ${
      wasm[at]
    } (${f32Bits(wasm[at])})`
  );
};

// the sha256 of the bits of the outputs of a scenario, fed block by block (a channel after the other), and the
// first samples of the first channel from its first sound on (what changed, when a golden fails)
export const createBitsHash = () => {
  const hash = createHash('sha256');
  const head: number[] = [];
  let frames = 0;
  let at = -1;
  return {
    add: (data: Float32Array, first = true) => {
      hash.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      if (!first) return;
      for (let i = 0; i < data.length && head.length < 8; i++) {
        if (at < 0 && data[i] === 0) continue;
        if (at < 0) at = frames + i;
        head.push(data[i]);
      }
      frames += data.length;
    },
    digest: (): Golden => ({ sha256: hash.digest('hex'), at, head }),
  };
};

interface Golden {
  sha256: string;
  // the first samples from the first sound on (frame `at`), to tell what changed
  at: number;
  head: number[];
}

const GOLDENS = join(__dirname, '../../../../dsp/goldens');
const UPDATE = Boolean(process.env['UPDATE_GOLDENS']);

// the goldens of a module: check() compares the hash of a scenario with its golden (UPDATE_GOLDENS: records it),
// call save() after the last one (afterAll). save() keeps the goldens of the scenarios a run skipped (`-t`): a
// removed scenario is removed from the file by hand
export const createGoldens = (module: string) => {
  const file = join(GOLDENS, `${module}.json`);
  const stored: Record<string, Golden> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const recorded: Record<string, Golden> = {};
  return {
    check: (scenario: string, golden: Golden) => {
      const { sha256 } = golden;
      recorded[scenario] = golden;
      if (UPDATE) return;
      const expected = stored[scenario];
      if (!expected) throw new Error(`no golden for ${module}: ${scenario} (UPDATE_GOLDENS=1 records it)`);
      if (expected.sha256 !== sha256)
        throw new Error(
          `${module}: ${scenario} sounds different (UPDATE_GOLDENS=1 records it): from frame ${
            golden.at
          }: ${golden.head.join(', ')}, golden from ${expected.at}: ${expected.head.join(', ')}`
        );
    },
    save: () => {
      if (!UPDATE) return;
      const all = { ...stored, ...recorded };
      const sorted = Object.fromEntries(
        Object.keys(all)
          .sort()
          .map((key) => [key, all[key]])
      );
      writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
    },
  };
};

export interface StereoCore {
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array) => void;
  free?: () => void;
}

// renders a core block by block over the input, `before` applies the changes of a block to it (messages,
// params) before it renders; fails on the first sample that is NaN or infinite, `check` sees the outputs of each
// block; returns the golden of the outputs (the core is freed)
export const runStereo = <T extends StereoCore>(
  scenario: string,
  {
    core,
    blocks,
    input,
    before,
    check,
  }: {
    core: T;
    blocks: number[];
    input: Signal;
    before?: (dsp: T, block: number) => void;
    check?: (outL: Float32Array, outR: Float32Array, block: number) => void;
  }
) => {
  const hash = createBitsHash();
  let frame = 0;
  blocks.forEach((n, block) => {
    const [inL, inR] = [0, 1].map((channel) =>
      Float32Array.from({ length: n }, (_, i) => input(frame + i, channel))
    );
    const [outL, outR] = [new Float32Array(n), new Float32Array(n)];
    before?.(core, block);
    core.process(inL, inR, outL, outR);
    expectFinite(scenario, block, outL);
    expectFinite(scenario, block, outR);
    check?.(outL, outR, block);
    hash.add(outL);
    hash.add(outR, false);
    frame += n;
  });
  core.free?.();
  return hash.digest();
};

// every sample of a block is a number (NaN and infinities fail with the first of them)
export const expectFinite = (scenario: string, block: number, data: Float32Array) => {
  const at = data.findIndex((value) => !Number.isFinite(value));
  if (at !== -1) throw new Error(`${scenario}: block ${block}, sample ${at} is ${data[at]}`);
};
