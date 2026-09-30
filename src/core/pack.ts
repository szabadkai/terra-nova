// A file format for structured data with typed arrays in it (saved games, maps): gzip over a
// four-letter magic, the little-endian u32 length of a JSON header, the header (each typed array
// replaced by {$buf: offset, type, n}), then the arrays' raw bytes, 8-byte aligned and offset from
// the end of the header.
export type TypedArray = Float32Array | Uint8Array | Int8Array | Int32Array | Uint32Array | Uint16Array | Int16Array | Float64Array;

const ARRAY_TYPES: Record<string, { new (b: ArrayBuffer, o?: number, n?: number): TypedArray; BYTES_PER_ELEMENT: number }> = {
  Float32Array, Float64Array, Uint8Array, Int8Array, Int32Array, Uint32Array, Uint16Array, Int16Array,
};

const align8 = (n: number) => (n + 7) & ~7;

/** The four letters of a file's kind as its first word. */
export const magicOf = (s: string) => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function packFile(data: unknown, magic: number): Promise<Uint8Array> {
  const bufs: TypedArray[] = [];
  let at = 0;
  const header = JSON.stringify(data, (_k, v) => {
    if (!ArrayBuffer.isView(v) || v instanceof DataView) return v;
    const a = v as TypedArray;
    bufs.push(a);
    const ref = { $buf: at, type: a.constructor.name, n: a.length };
    at = align8(at + a.byteLength);
    return ref;
  });
  const head = new TextEncoder().encode(header);
  const base = align8(8 + head.length);
  const raw = new Uint8Array(base + at);
  const dv = new DataView(raw.buffer);
  dv.setUint32(0, magic, true);
  dv.setUint32(4, head.length, true);
  raw.set(head, 8);
  let off = base;
  for (const a of bufs) {
    raw.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), off);
    off = align8(off + a.byteLength);
  }
  return pipe(raw, new CompressionStream('gzip'));
}

/** `notOne`: the error for a file of another kind; `damaged`: for one that does not hold together. */
export async function unpackFile(file: Uint8Array, magic: number, notOne: string, damaged: string): Promise<unknown> {
  let raw: Uint8Array;
  try { raw = await pipe(file, new DecompressionStream('gzip')); } catch { throw new Error(notOne); }
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.length < 8 || dv.getUint32(0, true) !== magic) throw new Error(notOne);
  const len = dv.getUint32(4, true);
  const base = align8(8 + len);
  let header: string;
  try { header = new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(8, 8 + len)); } catch { throw new Error(notOne); }
  return JSON.parse(header, (_k, v) => {
    if (!v || typeof v !== 'object' || typeof v.$buf !== 'number') return v;
    const T = ARRAY_TYPES[v.type];
    const start = base + v.$buf, bytes = v.n * (T?.BYTES_PER_ELEMENT ?? 0);
    if (!T || start + bytes > raw.length) throw new Error(damaged);
    // copy out so every array starts on its own aligned buffer
    return new T(raw.slice(start, start + bytes).buffer);
  });
}
