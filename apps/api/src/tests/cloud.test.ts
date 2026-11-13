import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";
import { GoogleDriveProvider } from "../providers/google.ts";
import { OneDriveProvider } from "../providers/onedrive.ts";
import { DropboxProvider } from "../providers/dropbox.ts";

// Adapters talk to the network through global fetch, so a scripted fetch stands in for each provider's API.
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
const tokens: any = { get: async () => "tok", invalidate: async () => "tok" };
type Call = { url: string; method: string; headers: Record<string, string>; body?: Uint8Array };
const calls: Call[] = [];
const json = (o: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" }, ...init });
function script(handler: (c: Call) => Response | Promise<Response>) {
  calls.length = 0;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const body = init.body instanceof ReadableStream ? new Uint8Array(await new Response(init.body).arrayBuffer()) : typeof init.body === "string" ? new TextEncoder().encode(init.body) : init.body ? new Uint8Array(init.body) : undefined;
    const c: Call = { url: String(input), method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body };
    calls.push(c); return handler(c);
  }) as typeof fetch;
}
const MB = 1024 * 1024;

describe("Google Drive adapter", () => {
  const g = new GoogleDriveProvider(tokens);
  it("lists with paging, maps folders/files, and never sends tokens off-host for thumbnails", async () => {
    script((c) => json({ nextPageToken: "n2", files: [
      { id: "f1", name: "Docs", mimeType: "application/vnd.google-apps.folder", parents: ["root1"] },
      { id: "i1", name: "a.jpg", mimeType: "image/jpeg", size: "123", md5Checksum: "abc", thumbnailLink: "https://lh3.googleusercontent.com/x=s220", modifiedTime: "2026-01-01T00:00:00Z" }] }));
    const r = await g.list("root");
    assert.equal(r.nextPageToken, "n2");
    assert.deepEqual(r.items.map((i) => [i.name, i.isFolder, i.size, i.hasThumbnail]), [["Docs", true, null, false], ["a.jpg", false, 123, true]]);
    assert.match(calls[0]!.url, /%27root%27\+in\+parents|'root'|root/);
    assert.equal(calls[0]!.headers.authorization, "Bearer tok");
  });
  it("uploads resumably in 16 MiB chunks with correct Content-Range and returns the file", async () => {
    const total = 40 * MB; let next = 0;
    script((c) => {
      if (c.url.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { location: "https://upload.example/session1" } });
      assert.equal(c.url, "https://upload.example/session1");
      assert.equal(c.headers.authorization, undefined, "session URL must not get our bearer token");
      const m = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(c.headers["content-range"]!)!;
      assert.equal(+m[1]!, next); next = +m[2]! + 1;
      return next === total ? json({ id: "new1", name: "big.bin", mimeType: "application/octet-stream", size: String(total) }) : new Response(null, { status: 308, headers: { range: `bytes=0-${next - 1}` } });
    });
    const out = await g.write({ parentId: "root", name: "big.bin", size: total, stream: Readable.from((function* () { for (let i = 0; i < 40; i++) yield Buffer.alloc(MB, 1); })()) });
    assert.equal(out.id, "new1"); assert.equal(next, total);
    assert.deepEqual(calls.slice(1).map((c) => c.headers["content-range"]), [`bytes 0-${16 * MB - 1}/*`, `bytes ${16 * MB}-${32 * MB - 1}/*`, `bytes ${32 * MB}-${total - 1}/${total}`]);
  });
  it("retries a failed chunk without restarting the file", async () => {
    let puts = 0;
    script((c) => {
      if (c.url.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { location: "https://upload.example/s2" } });
      if (c.headers["content-range"] === "bytes */*") return new Response(null, { status: 308 });
      if (++puts === 1) return new Response("boom", { status: 503 });
      return json({ id: "ok", name: "s.txt", mimeType: "text/plain", size: "5" });
    });
    assert.equal((await g.write({ parentId: "root", name: "s.txt", size: 5, stream: Readable.from([Buffer.from("hello")]) })).id, "ok");
  });
  it("forwards Range on reads and parses Content-Range; trashes instead of deleting", async () => {
    script((c) => c.url.includes("alt=media")
      ? new Response("lo", { status: 206, headers: { "content-range": "bytes 3-4/5", "content-length": "2" } })
      : json({ id: "i1", name: "t.txt", mimeType: "text/plain", size: "5" }));
    const r = await g.read("i1", { range: { start: 3, end: 4 } });
    assert.deepEqual(r.range, { start: 3, end: 4, total: 5 });
    assert.equal(calls.find((c) => c.url.includes("alt=media"))!.headers.range, "bytes=3-4");
    script(() => json({}));
    await g.delete("i1");
    assert.equal(calls[0]!.method, "PATCH"); assert.match(new TextDecoder().decode(calls[0]!.body), /"trashed":true/);
  });
});

describe("OneDrive adapter", () => {
  const o = new OneDriveProvider(tokens);
  it("lists, follows only Graph nextLinks, and uses an upload session for large files", async () => {
    script(() => json({ value: [{ id: "d1", name: "Z", folder: {} }, { id: "d2", name: "a.txt", size: 3, file: { mimeType: "text/plain" } }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }));
    const r = await o.list("root");
    assert.deepEqual(r.items.map((i) => i.name), ["Z", "a.txt"]); assert.equal(r.nextPageToken, "https://graph.microsoft.com/v1.0/next");
    await assert.rejects(() => o.list("root", { pageToken: "https://evil.example/steal" }));
    let end = 0; const total = 25 * MB;
    script((c) => {
      if (c.url.includes("createUploadSession")) return json({ uploadUrl: "https://up.example/u1" });
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(c.headers["content-range"]!)!; end = +m[2]! + 1;
      assert.equal(+m[3]!, total); assert.equal(c.headers.authorization, undefined);
      return end === total ? json({ id: "big", name: "x.bin", size: total, file: {} }) : json({}, { status: 202 });
    });
    const f = await o.write({ parentId: "root", name: "x.bin", size: total, stream: Readable.from((function* () { for (let i = 0; i < 25; i++) yield Buffer.alloc(MB); })()) });
    assert.equal(f.id, "big"); assert.equal(end, total);
    assert.equal(calls[1]!.headers["content-range"], `bytes 0-${10 * MB - 1}/${total}`, "chunks are multiples of 320 KiB");
  });
});

describe("Dropbox adapter", () => {
  const d = new DropboxProvider(tokens);
  it("uses paths as ids, lists with cursor paging, and escapes non-ASCII in the API-Arg header", async () => {
    script((c) => c.url.endsWith("list_folder") ? json({ entries: [{ ".tag": "folder", name: "Berkas", path_display: "/Berkas" }, { ".tag": "file", name: "é.jpg", path_display: "/é.jpg", size: 9, rev: "r1" }], has_more: true, cursor: "c1" }) : json({}));
    const r = await d.list("root");
    assert.equal(r.nextPageToken, "c1"); assert.deepEqual(r.items.map((i) => [i.id, i.parentId, i.hasThumbnail]), [["/Berkas", "root", false], ["/é.jpg", "root", true]]);
    script(() => new Response("x", { headers: { "dropbox-api-result": JSON.stringify({ name: "é.jpg", size: 1 }) } }));
    await d.read("/é.jpg");
    assert.match(calls[0]!.headers["dropbox-api-arg"]!, /\\u00e9/);
  });
  it("uploads small files in one call and large files via upload sessions", async () => {
    script(() => json({ name: "s.txt", path_display: "/s.txt", size: 2, rev: "1" }));
    await d.write({ parentId: "root", name: "s.txt", size: 2, stream: Readable.from([Buffer.from("hi")]) });
    assert.match(calls[0]!.url, /files\/upload$/);
    const steps: string[] = [];
    script((c) => { steps.push(c.url.split("/files/")[1]!); return c.url.includes("start") ? json({ session_id: "S" }) : c.url.includes("finish") ? json({ name: "b", path_display: "/b", size: 20 * MB, rev: "2" }) : json({}); });
    await d.write({ parentId: "root", name: "b", size: 20 * MB, stream: Readable.from((function* () { for (let i = 0; i < 20; i++) yield Buffer.alloc(MB); })()) });
    assert.deepEqual(steps, ["upload_session/start", "upload_session/append_v2", "upload_session/finish"]);
  });
  it("maps Dropbox 409 domain errors", async () => {
    script(() => new Response('{"error_summary":"path/not_found/"}', { status: 409 }));
    await assert.rejects(() => d.stat("/nope"), (e: any) => e.kind === "not_found");
    script(() => new Response('{"error_summary":"path/insufficient_space"}', { status: 409 }));
    await assert.rejects(() => d.createFolder("root", "x"), (e: any) => e.kind === "quota");
  });
});
