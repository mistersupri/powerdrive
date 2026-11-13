import type { Readable } from "node:stream";

export interface Chunk { data: Buffer; offset: number; last: boolean }

/**
 * Re-slices a stream into fixed-size chunks with a look-ahead so the final chunk is
 * flagged `last` even when the total size is unknown. Memory stays at ≤ 2 chunks.
 */
export async function* chunker(stream: Readable, chunkSize: number): AsyncGenerator<Chunk> {
  let parts: Buffer[] = [];
  let len = 0;
  let offset = 0;
  let pending: Buffer | null = null;

  for await (const piece of stream as AsyncIterable<Buffer>) {
    parts.push(piece);
    len += piece.length;
    while (len >= chunkSize) {
      const all = parts.length === 1 ? parts[0]! : Buffer.concat(parts);
      const out = all.subarray(0, chunkSize);
      const rest = all.subarray(chunkSize);
      if (pending) { yield { data: pending, offset, last: false }; offset += pending.length; }
      pending = Buffer.from(out);
      parts = rest.length ? [Buffer.from(rest)] : [];
      len = rest.length;
    }
  }
  const tail = len ? (parts.length === 1 ? parts[0]! : Buffer.concat(parts)) : null;
  if (pending) {
    if (tail) {
      yield { data: pending, offset, last: false }; offset += pending.length;
      yield { data: tail, offset, last: true };
    } else yield { data: pending, offset, last: true };
  } else if (tail) yield { data: tail, offset, last: true };
  else yield { data: Buffer.alloc(0), offset: 0, last: true };
}
