import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { chunker } from "../providers/chunker.ts";
import { decodeId, encodeId, ROOT } from "../providers/types.ts";

const collect = async (src: Buffer, size: number) => {
  const out = [];
  for await (const c of chunker(Readable.from([src.subarray(0, 7), src.subarray(7)]), size)) out.push({ len: c.data.length, offset: c.offset, last: c.last });
  return out;
};

describe("chunker (resumable-upload slicing)", () => {
  it("emits fixed-size chunks and flags only the final one", async () => {
    assert.deepEqual(await collect(Buffer.alloc(25), 10), [{ len: 10, offset: 0, last: false }, { len: 10, offset: 10, last: false }, { len: 5, offset: 20, last: true }]);
  });
  it("flags the last chunk even when the size is an exact multiple (needs look-ahead)", async () => {
    assert.deepEqual(await collect(Buffer.alloc(20), 10), [{ len: 10, offset: 0, last: false }, { len: 10, offset: 10, last: true }]);
  });
  it("handles inputs smaller than a chunk and empty inputs", async () => {
    assert.deepEqual(await collect(Buffer.alloc(3), 10), [{ len: 3, offset: 0, last: true }]);
    assert.deepEqual(await collect(Buffer.alloc(0), 10), [{ len: 0, offset: 0, last: true }]);
  });
  it("preserves bytes across chunk boundaries", async () => {
    const src = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    const parts: Buffer[] = [];
    for await (const c of chunker(Readable.from([src.subarray(0, 333), src.subarray(333, 334), src.subarray(334)]), 128)) parts.push(c.data);
    assert.deepEqual(Buffer.concat(parts), src);
  });
});

describe("opaque ids", () => {
  it("round-trips ids with slashes and unicode, and keeps root literal", () => {
    for (const raw of ["/Folder/Sub dir/file é.txt", "a/b/", "id:xyz", "~weird"]) assert.equal(decodeId(encodeId(raw)), raw);
    assert.equal(encodeId(ROOT), ROOT);
    assert.ok(!/[/+=]/.test(encodeId("/a/b/c?d=e")), "URL-safe");
  });
});
