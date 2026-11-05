// the processor state of the Audio Unit (`host state`) and the tables it plays: a magic (9 bytes),
// the length of a JSON header (u64), the header (its `hash` the md5 of the zstd frame), the size of
// the payload (u32), 2 (u32), a zstd frame of the payload: the CBOR of its modules (cbor.mjs). Oscillator A
// (`Oscillator0`) plays the table at the `relativePathToWT` of its `WTOsc0` (under the folder of its tables,
// RENDERS_TABLES) and has its `plainParams` ("default", or a map of the ones not at their default:
// kParamDetuneMode…).
// A state with them swapped plays a table of ours, written into User of that folder (the tables of its
// user), with the params we set. A mod slot (`ModSlot<i>`) routes a source (its index: 25 Macro 1) to a param of a
// module (its id and name: A Uni Blend is 27, kParamDetuneWid, of `Oscillator` 0) by `kParamAmount` (-100..100% of
// the travel of the knob) and `kParamBipolar`
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

// the folder of its noise samples (`relativePathToNoiseSample` is under it): beside the tables, in Samples
export const noisesFolder = () => tables().replace(/Tables\/?$/, 'Samples/Factory Non-Tonal/Noises');

// a small unsigned integer of CBOR as the states have it (one of 24 and up is encoded on a byte of its own)
const uint = (n) => (n < 24 ? n : { uint: n, info: 24 });

// the init state (`host state`) with oscillator i of `oscs` (A, B: `Oscillator<i>`) on `Tables/<path>` (a table of
// `frames` frames of 2048 samples) and with its plain params `params`; one not listed keeps the init's. Mod slot i
// of `slots` routes `source` to `param` (its id) named `name` of `Oscillator<osc>` by `amount` (%), `bipolar`.
// `noise` puts the noise oscillator (`Oscillator3`, its `NoiseOsc3`) on the sample at `path` (under the noises of
// the Audio Unit, noisesFolder(): `frames` frames of `channels` at `rate`) with the plain params of its sampler
// `params` (kParamOneShot…)
export const editedState = (initFile, oscs, slots = [], noise = null) => {
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
  if (noise) {
    const sampler = get(get(doc, 'Oscillator3'), 'NoiseOsc3');
    set(sampler, 'relativePathToNoiseSample', noise.path);
    set(sampler, 'numFrames', noise.frames);
    set(sampler, 'numChannels', noise.channels);
    set(sampler, 'sampleRate', noise.rate);
    if (noise.params) set(sampler, 'plainParams', { map: Object.entries(noise.params) });
  }
  slots.forEach(({ source, osc, param, name, amount, bipolar }, i) => {
    const params = [['kParamAmount', { f64: amount }], ...(bipolar ? [['kParamBipolar', { f32: 1 }]] : [])];
    set(doc, `ModSlot${i}`, {
      map: [
        ['destModuleID', uint(osc)],
        ['destModuleParamID', uint(param)],
        ['destModuleParamName', name],
        ['destModuleTypeString', 'Oscillator'],
        ['plainParams', { map: params, info: params.length }],
        ['source', { array: [uint(source), 0], info: 2 }],
      ],
      info: 6,
    });
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

// a sample of the noise oscillator: float32 at 44.1 kHz, one or two channels (interleaved), no mark
export const writeSample = (file, channels) => {
  const n = channels.length;
  const frames = channels[0].length;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + frames * n * 4, 4);
  head.write('WAVEfmt ', 8, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20);
  head.writeUInt16LE(n, 22);
  head.writeUInt32LE(44100, 24);
  head.writeUInt32LE(44100 * n * 4, 28);
  head.writeUInt16LE(n * 4, 32);
  head.writeUInt16LE(32, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(frames * n * 4, 40);
  const data = Buffer.alloc(frames * n * 4);
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < n; c++) data.writeFloatLE(channels[c][f], (f * n + c) * 4);
  writeFileSync(file, Buffer.concat([head, data]));
};
