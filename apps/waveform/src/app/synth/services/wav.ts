const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

export interface Wav {
  sampleRate: number;
  // the first channel, as stored in the file (no resampling)
  samples: Float32Array;
}

interface Format {
  format: number;
  channels: number;
  sampleRate: number;
  blockAlign: number;
  bits: number;
}

const text = (view: DataView, offset: number) =>
  String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));

const readFormat = (view: DataView, offset: number, size: number): Format => {
  if (size < 16) throw new Error('WAV fmt chunk is too short');
  const tag = view.getUint16(offset, true);
  return {
    // the extensible format keeps the real one in the first 2 bytes of its sub-format GUID
    format: tag === EXTENSIBLE && size >= 26 ? view.getUint16(offset + 24, true) : tag,
    channels: view.getUint16(offset + 2, true),
    sampleRate: view.getUint32(offset + 4, true),
    blockAlign: view.getUint16(offset + 12, true),
    bits: view.getUint16(offset + 14, true),
  };
};

const sampleReader = ({ format, bits }: Format): ((view: DataView, offset: number) => number) => {
  if (format === FLOAT && bits === 32) return (view, offset) => view.getFloat32(offset, true);
  if (format === FLOAT && bits === 64) return (view, offset) => view.getFloat64(offset, true);
  if (format === PCM && bits === 8) return (view, offset) => (view.getUint8(offset) - 128) / 128;
  if (format === PCM && bits === 16) return (view, offset) => view.getInt16(offset, true) / 0x8000;
  if (format === PCM && bits === 24)
    return (view, offset) => ((view.getInt8(offset + 2) << 16) | view.getUint16(offset, true)) / 0x800000;
  if (format === PCM && bits === 32) return (view, offset) => view.getInt32(offset, true) / 0x80000000;
  throw new Error(`Unsupported WAV format ${format} with ${bits} bits`);
};

// the samples of a RIFF WAVE file as stored, without resampling
export const parseWav = (buffer: ArrayBuffer): Wav => {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || text(view, 0) !== 'RIFF' || text(view, 8) !== 'WAVE')
    throw new Error('Not a WAV file');

  let fmt: Format | undefined;
  let data: { offset: number; size: number } | undefined;
  for (let offset = 12; offset + 8 <= buffer.byteLength && !data; ) {
    const id = text(view, offset);
    // a truncated file still has the bytes it has
    const size = Math.min(view.getUint32(offset + 4, true), buffer.byteLength - offset - 8);
    if (id === 'fmt ') fmt = readFormat(view, offset + 8, size);
    if (id === 'data') data = { offset: offset + 8, size };
    // chunks are word aligned
    offset += 8 + size + (size % 2);
  }
  if (!fmt) throw new Error('WAV file has no fmt chunk');
  if (!data) throw new Error('WAV file has no data chunk');

  const read = sampleReader(fmt);
  const { blockAlign } = fmt;
  if (fmt.channels === 0 || blockAlign < (fmt.bits / 8) * fmt.channels)
    throw new Error(`Invalid WAV block align ${blockAlign}`);
  const samples = new Float32Array(Math.floor(data.size / blockAlign));
  for (let i = 0; i < samples.length; i++) samples[i] = read(view, data.offset + i * blockAlign);
  return { sampleRate: fmt.sampleRate, samples };
};
