// the processor state of the Audio Unit (`host state`) and the tables it plays: a magic (9 bytes),
// the length of a JSON header (u64), the header (its `hash` the md5 of the zstd frame), the size of
// the payload (u32), 2 (u32), a zstd frame of the payload: the CBOR of its modules (cbor.mjs). Oscillator A
// (`Oscillator0`) plays the table at the `relativePathToWT` of its `WTOsc0` (under the folder of its tables,
// RENDERS_TABLES) and has its `plainParams` ("default", or a map of the ones not at their default:
// kParamDetuneMode…).
// A state with them swapped plays a table of ours, written into User of that folder (the tables of its
// user), with the params we set
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { decode, encode, get, set } from './cbor.mjs';

// the folder of the tables of the Audio Unit: RENDERS_TABLES of .env (run.mjs reads it)
export const tables = () => {
  if (!process.env.RENDERS_TABLES)
    throw new Error('RENDERS_TABLES of .env: the folder of the tables of the Audio Unit');
  return process.env.RENDERS_TABLES;
};

// the init state (`host state`) with oscillator i of `oscs` (A, B: `Oscillator<i>`) on `Tables/<path>` (a table of
// `frames` frames of 2048 samples) and with its plain params `params`; one not listed keeps the init's
export const editedState = (initFile, oscs) => {
  const init = readFileSync(initFile);
  const length = Number(init.readBigUInt64LE(9));
  const header = JSON.parse(init.subarray(17, 17 + length).toString());
  const doc = decode(zlib.zstdDecompressSync(init.subarray(17 + length + 8)));
  oscs.forEach(({ path, frames, params }, i) => {
    const osc = get(doc, `Oscillator${i}`);
    if (path) {
      const table = get(osc, `WTOsc${i}`);
      set(table, 'relativePathToWT', path);
      set(table, 'numFrames', frames * 2048);
    }
    if (params) set(osc, 'plainParams', { map: Object.entries(params) });
  });
  const payload = encode(doc);
  const zstd = zlib.zstdCompressSync(payload);
  header.hash = crypto.createHash('md5').update(zstd).digest('hex');
  const json = Buffer.from(JSON.stringify(header));
  const sizes = Buffer.alloc(16);
  sizes.writeBigUInt64LE(BigInt(json.length), 0);
  sizes.writeUInt32LE(payload.length, 8);
  sizes.writeUInt32LE(2, 12);
  return Buffer.concat([init.subarray(0, 9), sizes.subarray(0, 8), json, sizes.subarray(8), zstd]);
};

// a wavetable file: float32 mono at 44.1 kHz, frames of 2048 samples, its mark (clm chunk)
// `<!>2048 <flags> …`
export const writeTable = (file, frames, flags) => {
  const chunk = (id, body) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'latin1');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(3, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(44100, 4);
  fmt.writeUInt32LE(44100 * 4, 8);
  fmt.writeUInt16LE(4, 12);
  fmt.writeUInt16LE(32, 14);
  const data = Buffer.alloc(frames.length * 2048 * 4);
  frames.forEach((frame, k) => frame.forEach((value, i) => data.writeFloatLE(value, (k * 2048 + i) * 4)));
  const body = Buffer.concat([
    Buffer.from('WAVE'),
    chunk('fmt ', fmt),
    chunk('clm ', Buffer.from(`<!>2048 ${flags} wavetable`, 'latin1')),
    chunk('data', data),
  ]);
  writeFileSync(file, chunk('RIFF', body));
};
