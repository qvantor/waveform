// CBOR (RFC 8949) for the states of the Audio Unit (state.mjs): decode keeps the width of each float
// ({ f16 }, { f32 }, { f64 }) and of each length, so encode gives the same bytes back (checked on its states and
// presets); a map is { map: [[key, value]…] }
export const decode = (buf) => {
  let at = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const head = () => {
    const byte = buf[at++];
    const major = byte >> 5,
      info = byte & 31;
    let n = info;
    if (info === 24) n = buf[at++];
    else if (info === 25) {
      n = view.getUint16(at);
      at += 2;
    } else if (info === 26) {
      n = view.getUint32(at);
      at += 4;
    } else if (info === 27) {
      n = Number(view.getBigUint64(at));
      at += 8;
    } else if (info > 27) throw new Error(`info ${info}`);
    return { major, info, n };
  };
  const item = () => {
    const { major, info, n } = head();
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 25) return { f16: n };
      if (info === 26) return { f32: new Float32Array(new Uint32Array([n]).buffer)[0] };
      if (info === 27) {
        at -= 8;
        const v = view.getFloat64(at);
        at += 8;
        return { f64: v };
      }
      throw new Error(`simple ${info}`);
    }
    if (major === 0) return info < 24 ? n : { uint: n, info };
    if (major === 1) return { neg: n, info };
    if (major === 2) {
      const v = buf.subarray(at, at + n);
      at += n;
      return { bytes: Buffer.from(v), info };
    }
    if (major === 3) {
      const v = buf.subarray(at, at + n).toString();
      at += n;
      return info < 24 ? v : { text: v, info };
    }
    if (major === 4) return { array: Array.from({ length: n }, item), info };
    if (major === 5) {
      const entries = [];
      for (let i = 0; i < n; i++) entries.push([item(), item()]);
      return { map: entries, info };
    }
    if (major === 6) return { tag: n, value: item(), info };
  };
  return item();
};

export const encode = (value) => {
  const out = [];
  const head = (major, n, info) => {
    const fit = info ?? (n < 24 ? n : n < 256 ? 24 : n < 65536 ? 25 : n < 2 ** 32 ? 26 : 27);
    if (fit < 24) return out.push(Buffer.from([(major << 5) | n]));
    const bytes = { 24: 1, 25: 2, 26: 4, 27: 8 }[fit];
    const b = Buffer.alloc(1 + bytes);
    b[0] = (major << 5) | fit;
    if (bytes === 8) b.writeBigUInt64BE(BigInt(n), 1);
    else b.writeUIntBE(n, 1, bytes);
    out.push(b);
  };
  const item = (v) => {
    if (v === false) return out.push(Buffer.from([0xf4]));
    if (v === true) return out.push(Buffer.from([0xf5]));
    if (v === null) return out.push(Buffer.from([0xf6]));
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0) return head(0, v);
      if (Number.isInteger(v)) return head(1, -1 - v);
      const b = Buffer.alloc(9);
      b[0] = 0xfb;
      b.writeDoubleBE(v, 1);
      return out.push(b);
    }
    if (typeof v === 'string') {
      const b = Buffer.from(v);
      head(3, b.length);
      return out.push(b);
    }
    if ('f16' in v) {
      const b = Buffer.alloc(3);
      b[0] = 0xf9;
      b.writeUInt16BE(v.f16, 1);
      return out.push(b);
    }
    if ('f32' in v) {
      const b = Buffer.alloc(5);
      b[0] = 0xfa;
      b.writeFloatBE(v.f32, 1);
      return out.push(b);
    }
    if ('f64' in v) {
      const b = Buffer.alloc(9);
      b[0] = 0xfb;
      b.writeDoubleBE(v.f64, 1);
      return out.push(b);
    }
    if ('uint' in v) return head(0, v.uint, v.info);
    if ('neg' in v) return head(1, v.neg, v.info);
    if ('bytes' in v) {
      head(2, v.bytes.length, v.info);
      return out.push(v.bytes);
    }
    if ('text' in v) {
      const b = Buffer.from(v.text);
      head(3, b.length, v.info);
      return out.push(b);
    }
    if ('array' in v) {
      head(4, v.array.length, v.info);
      return v.array.forEach(item);
    }
    if ('map' in v) {
      head(5, v.map.length, v.info);
      return v.map.forEach(([k, x]) => {
        item(k);
        item(x);
      });
    }
    if ('tag' in v) {
      head(6, v.tag, v.info);
      return item(v.value);
    }
    throw new Error(`cannot encode ${JSON.stringify(v)}`);
  };
  item(value);
  return Buffer.concat(out);
};
// the value of a key of a map
export const get = (map, key) => map.map.find(([k]) => (k.text ?? k) === key)?.[1];
export const set = (map, key, value) => {
  const entry = map.map.find(([k]) => (k.text ?? k) === key);
  if (entry) entry[1] = value;
  else map.map.push([key, value]);
};
