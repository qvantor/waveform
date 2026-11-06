// WAV in and out for the noise samples: PCM or float in, float32 channels out; float32 WAV written.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export function readWav(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a wav: ' + file);
  let fmt;
  let data;
  for (let i = 12; i + 8 <= b.length;) {
    const id = b.toString('ascii', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === 'fmt ') {
      let format = b.readUInt16LE(i + 8);
      if (format === 0xfffe) format = b.readUInt16LE(i + 8 + 24);
      fmt = {
        format,
        channels: b.readUInt16LE(i + 10),
        rate: b.readUInt32LE(i + 12),
        bits: b.readUInt16LE(i + 22),
      };
    } else if (id === 'data') data = b.subarray(i + 8, i + 8 + size);
    i += 8 + size + (size & 1);
  }
  const { format, channels, rate, bits } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const o = (f * channels + c) * bytes;
      let v;
      if (format === 3) v = bits === 64 ? data.readDoubleLE(o) : data.readFloatLE(o);
      else if (bits === 16) v = data.readInt16LE(o) / 32768;
      else if (bits === 24) v = data.readIntLE(o, 3) / 8388608;
      else if (bits === 32) v = data.readInt32LE(o) / 2147483648;
      else if (bits === 8) v = (data[o] - 128) / 128;
      else throw new Error(`format ${format}/${bits} of ${file}`);
      out[c][f] = Number.isFinite(v) ? v : 0;
    }
  }
  return { rate, channels: out };
}

// Float32 WAV (format 3), interleaved.
export function writeWav(file, rate, channels) {
  const n = channels.length;
  const frames = channels[0].length;
  const b = Buffer.alloc(44 + frames * n * 4);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + frames * n * 4, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20);
  b.writeUInt16LE(n, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * n * 4, 28);
  b.writeUInt16LE(n * 4, 32);
  b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(frames * n * 4, 40);
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < n; c++) b.writeFloatLE(channels[c][f], 44 + (f * n + c) * 4);
  writeFileSync(file, b);
}

// Any file CoreAudio reads (wav, aiff, flac, mp3) at `rate`, decoded and resampled by its best converter in
// one step (macOS: afconvert), with the rate it had.
export function decode(file, tmpFile, rate) {
  execFileSync('afconvert', [
    '-f',
    'WAVE',
    '-d',
    `LEF32@${rate}`,
    '-r',
    '127',
    '--src-complexity',
    'bats',
    file,
    tmpFile,
  ]);
  const info = execFileSync('afinfo', [file], { encoding: 'utf8' });
  return { ...readWav(tmpFile), sourceRate: Number(info.match(/(\d+) Hz/)?.[1] ?? 0) };
}
