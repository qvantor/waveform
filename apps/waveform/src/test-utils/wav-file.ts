// builds RIFF WAVE files byte by byte, the way the wavetable files in S3 are laid out

export const PCM = 1;
export const FLOAT = 3;

interface Encoding {
  format?: number;
  bits?: number;
}

export const ascii = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));

const concat = (...parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

// a chunk with its header and the pad byte of an odd body; `size` is what the header says
export const chunk = (id: string, body: Uint8Array, size = body.length) => {
  const bytes = new Uint8Array(8 + body.length + (body.length % 2));
  bytes.set(ascii(id));
  new DataView(bytes.buffer).setUint32(4, size, true);
  bytes.set(body, 8);
  return bytes;
};

export const riff = (...chunks: Uint8Array[]) => {
  const body = concat(ascii('WAVE'), ...chunks);
  const header = new DataView(new ArrayBuffer(8));
  header.setUint32(4, body.length, true);
  return concat(ascii('RIFF'), new Uint8Array(header.buffer, 4), body).buffer;
};

export const fmt = ({
  format = FLOAT,
  bits = 32,
  channels = 1,
  sampleRate = 44100,
  extensible = false,
}: Encoding & { channels?: number; sampleRate?: number; extensible?: boolean } = {}) => {
  const view = new DataView(new ArrayBuffer(extensible ? 40 : 16));
  const blockAlign = (channels * bits) / 8;
  view.setUint16(0, extensible ? 0xfffe : format, true);
  view.setUint16(2, channels, true);
  view.setUint32(4, sampleRate, true);
  view.setUint32(8, sampleRate * blockAlign, true);
  view.setUint16(12, blockAlign, true);
  view.setUint16(14, bits, true);
  if (extensible) {
    view.setUint16(16, 22, true);
    view.setUint16(18, bits, true);
    // the sub-format GUID starts with the format code
    view.setUint16(24, format, true);
  }
  return chunk('fmt ', new Uint8Array(view.buffer));
};

// interleaved samples as stored: floats, or the raw integers of PCM (8 bit unsigned)
export const encode = (values: number[], { format = FLOAT, bits = 32 }: Encoding = {}) => {
  const size = bits / 8;
  const view = new DataView(new ArrayBuffer(values.length * size));
  values.forEach((value, i) => {
    const offset = i * size;
    if (format === FLOAT && bits === 64) view.setFloat64(offset, value, true);
    else if (format === FLOAT) view.setFloat32(offset, value, true);
    else if (bits === 8) view.setUint8(offset, value);
    else if (bits === 16) view.setInt16(offset, value, true);
    else if (bits === 24) {
      view.setUint16(offset, value & 0xffff, true);
      view.setInt8(offset + 2, value >> 16);
    } else view.setInt32(offset, value, true);
  });
  return new Uint8Array(view.buffer);
};

export const data = (values: number[], encoding: Encoding = {}) => chunk('data', encode(values, encoding));

// the layout of a wavetable file: JUNK, fmt, clm (the wave size), data in mono 32 bit float
export const wavetableFile = (samples: ArrayLike<number>, sampleRate = 44100) =>
  riff(
    chunk('JUNK', new Uint8Array(28)),
    fmt({ sampleRate }),
    chunk('clm ', ascii('<!>2048 20000000 wavetable (www.xferrecords.com)')),
    data(Array.from(samples))
  );
