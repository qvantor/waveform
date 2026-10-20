// the processor state of the Audio Unit (`host state`) and the tables it plays: a magic (9 bytes),
// the length of a JSON header (u64), the header (its `hash` the md5 of the zstd frame), the size of
// the payload (u32), 2 (u32), a zstd frame of the payload: the CBOR of its modules. Oscillator A plays the table at
// its `relativePathToWT` (in the folder of its tables, RENDERS_TABLES): a state with that path swapped plays
// a table of ours, written into User of that folder
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

// the folder of the tables of the Audio Unit: RENDERS_TABLES of .env (run.mjs reads it)
export const tables = () => {
  if (!process.env.RENDERS_TABLES)
    throw new Error('RENDERS_TABLES of .env: the folder of the tables of the Audio Unit');
  return process.env.RENDERS_TABLES;
};
const INIT_TABLE = 'S2 Tables/Default Shapes.wav';

// a CBOR text string
const text = (value) => {
  const bytes = Buffer.from(value);
  if (bytes.length > 255) throw new Error(`${value} is too long`);
  return Buffer.concat([
    Buffer.from(bytes.length < 24 ? [0x60 + bytes.length] : [0x78, bytes.length]),
    bytes,
  ]);
};

// the init state (`host state`) with osc A on `Tables/<path>`, a table of `frames` frames of 2048 samples
export const stateWithTable = (initFile, path, frames) => {
  const init = readFileSync(initFile);
  const length = Number(init.readBigUInt64LE(9));
  const header = JSON.parse(init.subarray(17, 17 + length).toString());
  const rest = init.subarray(17 + length);
  let payload = zlib.zstdDecompressSync(rest.subarray(8));
  const from = text(INIT_TABLE);
  const at = payload.indexOf(from);
  if (at < 0) throw new Error(`the state has no ${INIT_TABLE}`);
  payload = Buffer.concat([payload.subarray(0, at), text(path), payload.subarray(at + from.length)]);
  // numFrames: the samples of the table (18432, a u16 in CBOR)
  const key = Buffer.concat([text('numFrames'), Buffer.from([0x19])]);
  const k = payload.indexOf(key);
  if (k >= 0) payload.writeUInt16BE(frames * 2048, k + key.length);
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
