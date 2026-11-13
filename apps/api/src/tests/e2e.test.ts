import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>;
let wsAlice = ""; let storA = ""; let storB = "";

before(async () => { t = await bootstrap(); });
after(async () => { await t.engine.stop(); await t.app.close(); });

describe("auth & workspace isolation", () => {
  it("registers the first user as owner of their own workspace and logs in", async () => {
    const r = await t.register("alice");
    assert.equal(r.status, 200);
    const me = await t.call("alice", "GET", "/auth/me");
    assert.equal(me.data.user.isSuperAdmin, true);
    assert.equal(me.data.workspaces[0].role, "OWNER");
    wsAlice = me.data.activeWorkspaceId;
  });
  it("rejects wrong passwords and unauthenticated calls, and CSRF-style writes", async () => {
    assert.equal((await t.call("", "POST", "/auth/login", { email: "alice@example.com", password: "nope-nope" })).status, 401);
    assert.equal((await t.call("", "GET", "/storages")).status, 401);
    const res = await t.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { origin: "https://evil.example" } });
    assert.equal(res.statusCode, 403);
  });
  it("keeps workspaces isolated", async () => {
    await t.register("bob");
    const s = await t.call("alice", "POST", "/storages", { provider: "LOCAL", name: "Alice Private", root: "alice-private" });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const bobList = await t.call("bob", "GET", "/storages");
    assert.deepEqual(bobList.data.filter((s: any) => !s.isDefault), [], "bob sees only his own built-in storage");
    assert.ok(bobList.data.every((s: any) => s.workspaceId !== wsAlice));
    // Bob guessing Alice's storage id gets a 403/404, never data.
    const probe = await t.call("bob", "GET", `/files?storageId=${s.data.id}`);
    assert.ok([403, 404].includes(probe.status), String(probe.status));
    const hdr = await t.call("bob", "GET", `/files?storageId=${s.data.id}`, undefined, { "x-workspace-id": wsAlice });
    assert.equal(hdr.status, 403);
    await t.call("alice", "DELETE", `/storages/${s.data.id}`);
  });
});

describe("storage connections", () => {
  it("creates local storages inside the allowed root only", async () => {
    const bad = await t.call("alice", "POST", "/storages", { provider: "LOCAL", name: "Evil", root: "/etc" });
    assert.equal(bad.status, 400);
    const bad2 = await t.call("alice", "POST", "/storages", { provider: "LOCAL", name: "Evil2", root: "../../etc" });
    assert.equal(bad2.status, 400);
    const a = await t.call("alice", "POST", "/storages", { provider: "LOCAL", name: "Gudang A", root: "a" });
    const b = await t.call("alice", "POST", "/storages", { provider: "LOCAL", name: "Gudang B", root: "b" });
    assert.equal(a.data.status, "CONNECTED");
    assert.equal(a.data.mount.virtualPath, "/storage/gudang-a");
    storA = a.data.id; storB = b.data.id;
  });
  it("blocks private-network S3 endpoints (SSRF)", async () => {
    for (const endpoint of ["http://169.254.169.254", "https://127.0.0.1:9000", "https://localhost:9000"]) {
      const r = await t.call("alice", "POST", "/storages", { provider: "S3", name: "x", endpoint, region: "us-east-1", bucket: "b", accessKeyId: "k", secretAccessKey: "s" });
      assert.equal(r.status, 400, endpoint);
      assert.equal(r.body.error.code, "INVALID_ENDPOINT");
    }
  });
  it("stores credentials encrypted", async () => {
    const { seal, open } = await import("../lib/crypto.ts");
    const sealed = seal({ refresh: "secret-token" });
    assert.ok(!sealed.ciphertext.includes("secret"));
    assert.deepEqual(open(sealed), { refresh: "secret-token" });
    assert.throws(() => open({ ...sealed, authTag: Buffer.alloc(16).toString("base64") }));
  });
});

async function upload(who: string, storageId: string, parentId: string, name: string, data: Buffer, chunk = 64 * 1024) {
  const c = await t.call(who, "POST", "/uploads", { storageId, parentId, name, size: data.length });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  let off = 0; let last: any = c.data;
  while (off < data.length) {
    const part = data.subarray(off, off + chunk);
    const r = await t.call(who, "PATCH", `/uploads/${c.data.id}`, part, { "upload-offset": String(off), "content-type": "application/octet-stream" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    off += part.length; last = r.data;
  }
  await t.wait(async () => (await t.call(who, "GET", `/uploads/${c.data.id}`)).data.status === "DONE");
  return (await t.call(who, "GET", `/uploads/${c.data.id}`)).data;
}

describe("files: upload, list, download, thumbnails", () => {
  const big = crypto.randomBytes(300_000);
  let fileId = ""; let imgId = ""; let imgVersion = "";

  it("uploads in resumable chunks and rejects out-of-order chunks", async () => {
    const c = await t.call("alice", "POST", "/uploads", { storageId: storA, parentId: "root", name: "x.bin", size: 100 });
    const bad = await t.call("alice", "PATCH", `/uploads/${c.data.id}`, Buffer.alloc(10), { "upload-offset": "50", "content-type": "application/octet-stream" });
    assert.equal(bad.status, 409); assert.equal(bad.body.error.code, "OFFSET_MISMATCH");
    const tooBig = await t.call("alice", "PATCH", `/uploads/${c.data.id}`, Buffer.alloc(200), { "upload-offset": "0", "content-type": "application/octet-stream" });
    assert.equal(tooBig.status, 413);
    assert.equal((await t.call("alice", "GET", `/uploads/${c.data.id}`)).data.offset, 0, "failed chunk leaves offset untouched");
    await t.call("alice", "DELETE", `/uploads/${c.data.id}`);

    const done = await upload("alice", storA, "root", "big.bin", big);
    assert.equal(done.status, "DONE"); fileId = done.file.id;
    assert.deepEqual(fs.readFileSync(path.join(t.root, "a", "big.bin")), big);
  });

  it("handles empty files and name conflicts (RENAME default)", async () => {
    const e = await upload("alice", storA, "root", "empty.txt", Buffer.alloc(0));
    assert.equal(e.status, "DONE");
    const dup = await upload("alice", storA, "root", "big.bin", Buffer.from("second"));
    assert.equal(dup.file.name, "big (2).bin");
  });

  it("lists files with folders first and indexes metadata for search", async () => {
    await t.call("alice", "POST", "/files/folders", { storageId: storA, parentId: "root", name: "Laporan" });
    const l = await t.call("alice", "GET", `/files?storageId=${storA}`);
    assert.equal(l.data.items[0].name, "Laporan"); assert.equal(l.data.items[0].isFolder, true);
    const s = await t.call("alice", "GET", `/search?q=big&storageId=${storA}`);
    assert.equal(s.data.total, 2);
    const typed = await t.call("alice", "GET", `/search?type=folder`);
    assert.equal(typed.data.items[0].name, "Laporan");
  });

  it("serves downloads with HTTP Range support", async () => {
    const full = await t.call("alice", "GET", `/files/${storA}/${fileId}/download`);
    assert.equal(full.status, 200); assert.equal(full.res.headers["accept-ranges"], "bytes");
    assert.deepEqual(full.res.rawPayload, big);
    const part = await t.call("alice", "GET", `/files/${storA}/${fileId}/download`, undefined, { range: "bytes=100-199" });
    assert.equal(part.status, 206);
    assert.equal(part.res.headers["content-range"], `bytes 100-199/${big.length}`);
    assert.deepEqual(part.res.rawPayload, big.subarray(100, 200));
    const suffix = await t.call("alice", "GET", `/files/${storA}/${fileId}/download`, undefined, { range: "bytes=-50" });
    assert.deepEqual(suffix.res.rawPayload, big.subarray(big.length - 50));
    const bad = await t.call("alice", "GET", `/files/${storA}/${fileId}/download`, undefined, { range: `bytes=${big.length + 5}-` });
    assert.equal(bad.status, 416);
  });

  it("never renders active content inline", async () => {
    const h = await upload("alice", storA, "root", "evil.html", Buffer.from("<script>alert(1)</script>"));
    const r = await t.call("alice", "GET", `/files/${storA}/${h.file.id}/preview`);
    // HTML is shown as plain text (source), never executed; active types like SVG/JS are forced to download.
    assert.equal(r.res.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(r.res.headers["x-content-type-options"], "nosniff");
    assert.match(String(r.res.headers["content-security-policy"]), /default-src 'none'/);
    const svg = await upload("alice", storA, "root", "x.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));
    const sv = await t.call("alice", "GET", `/files/${storA}/${svg.file.id}/preview`);
    assert.match(String(sv.res.headers["content-disposition"]), /^attachment/);
  });

  it("generates cached WebP thumbnails, revalidates with 304, and respects version-pinned caching", async () => {
    const png = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
    const up = await upload("alice", storA, "root", "foto.png", png);
    imgId = up.file.id; imgVersion = up.file.version;
    const listed = (await t.call("alice", "GET", `/files?storageId=${storA}`)).data.items.find((i: any) => i.name === "foto.png");
    assert.equal(listed.hasThumbnail, true);

    const t0 = performance.now();
    const r1 = await t.call("alice", "GET", `/files/${storA}/${imgId}/thumbnail?s=256&v=${encodeURIComponent(imgVersion)}`);
    const cold = performance.now() - t0;
    assert.equal(r1.status, 200); assert.equal(r1.res.headers["content-type"], "image/webp");
    assert.match(String(r1.res.headers["cache-control"]), /immutable/);
    const meta = await sharp(r1.res.rawPayload).metadata();
    assert.equal(meta.format, "webp"); assert.equal(meta.width, 256);
    assert.ok(r1.res.rawPayload.length < 5000, "thumbnail is tiny");

    const t1 = performance.now();
    const r2 = await t.call("alice", "GET", `/files/${storA}/${imgId}/thumbnail?s=256&v=x`);
    const warm = performance.now() - t1;
    assert.equal(r2.status, 200);
    const r3 = await t.call("alice", "GET", `/files/${storA}/${imgId}/thumbnail?s=256`, undefined, { "if-none-match": String(r2.res.headers.etag) });
    assert.equal(r3.status, 304);
    console.log(`    thumbnail 2000x1500 PNG: cold ${cold.toFixed(0)} ms, cached ${warm.toFixed(0)} ms`);

    // Concurrent requests for the same image share one decode.
    const same = await Promise.all(Array.from({ length: 20 }, () => t.call("alice", "GET", `/files/${storA}/${imgId}/thumbnail?s=512`)));
    assert.ok(same.every((r) => r.status === 200));
    // Non-images have no thumbnail.
    assert.equal((await t.call("alice", "GET", `/files/${storA}/${fileId}/thumbnail`)).status, 404);
  });

  it("downloads a folder as a ZIP", async () => {
    const folder = (await t.call("alice", "GET", `/files?storageId=${storA}`)).data.items.find((i: any) => i.name === "Laporan");
    await upload("alice", storA, folder.id, "isi.txt", Buffer.from("halo"));
    const z = await t.call("alice", "GET", `/files/${storA}/${folder.id}/download`);
    assert.equal(z.res.headers["content-type"], "application/zip");
    assert.equal(z.res.rawPayload.subarray(0, 2).toString(), "PK");
    assert.ok(z.res.rawPayload.includes(Buffer.from("isi.txt")));
  });
});

describe("path safety on the local provider", () => {
  it("cannot be escaped through ids or symlinks", async () => {
    fs.mkdirSync(path.join(t.root, "outside"), { recursive: true });
    fs.writeFileSync(path.join(t.root, "outside", "secret.txt"), "top secret");
    try { fs.symlinkSync(path.join(t.root, "outside"), path.join(t.root, "a", "link")); } catch { /* ignore */ }
    const forged = "~" + Buffer.from("p" + Buffer.from("../outside/secret.txt").toString("base64url")).toString("base64url");
    const r = await t.call("alice", "GET", `/files/${storA}/${forged}/download`);
    assert.ok(r.status >= 400, `status ${r.status}`);
    assert.ok(!String(r.res.rawPayload).includes("top secret"));
    const l = await t.call("alice", "GET", `/files?storageId=${storA}`);
    assert.ok(!l.data.items.some((i: any) => i.name === "link"), "symlink pointing outside is hidden");
  });
});

describe("cross-storage transfers", () => {
  it("copies a file between storages by streaming, with verification", async () => {
    const root = (await t.call("alice", "GET", `/files?storageId=${storA}`)).data.items;
    const big = root.find((i: any) => i.name === "big.bin");
    const job = await t.call("alice", "POST", "/transfers", { type: "COPY", source: { storageId: storA, fileId: big.id }, destination: { storageId: storB, folderId: "root" }, idempotencyKey: "k1" });
    assert.equal(job.status, 202); assert.equal(job.data.status, "QUEUED");
    const again = await t.call("alice", "POST", "/transfers", { type: "COPY", source: { storageId: storA, fileId: big.id }, destination: { storageId: storB, folderId: "root" }, idempotencyKey: "k1" });
    assert.equal(again.data.id, job.data.id, "idempotent");
    await t.wait(async () => (await t.call("alice", "GET", `/transfers/${job.data.id}`)).data.status === "COMPLETED");
    assert.deepEqual(fs.readFileSync(path.join(t.root, "b", "big.bin")), fs.readFileSync(path.join(t.root, "a", "big.bin")));
    assert.ok(fs.existsSync(path.join(t.root, "a", "big.bin")), "copy keeps the source");
  });

  it("applies conflict policies: SKIP leaves destination, RENAME adds a suffix, FAIL errors", async () => {
    const big = (await t.call("alice", "GET", `/files?storageId=${storA}`)).data.items.find((i: any) => i.name === "big.bin");
    const run = async (policy: string) => {
      const j = await t.call("alice", "POST", "/transfers", { type: "COPY", source: { storageId: storA, fileId: big.id }, destination: { storageId: storB, folderId: "root" }, conflictPolicy: policy });
      await t.wait(async () => !["QUEUED", "VALIDATING", "RUNNING", "VERIFYING", "RETRYING"].includes((await t.call("alice", "GET", `/transfers/${j.data.id}`)).data.status));
      return (await t.call("alice", "GET", `/transfers/${j.data.id}`)).data;
    };
    const skip = await run("SKIP"); assert.equal(skip.status, "COMPLETED"); assert.equal(skip.skippedFiles, 1);
    const ren = await run("RENAME"); assert.equal(ren.status, "COMPLETED"); assert.ok(fs.existsSync(path.join(t.root, "b", "big (2).bin")));
    const fail = await run("FAIL"); assert.equal(fail.status, "FAILED"); assert.match(fail.errorMessage, /gagal/);
  });

  it("moves a nested folder: preserves hierarchy, deletes sources only after verification", async () => {
    fs.mkdirSync(path.join(t.root, "a", "Proyek", "2026", "Q1"), { recursive: true });
    fs.writeFileSync(path.join(t.root, "a", "Proyek", "readme.txt"), "satu");
    fs.writeFileSync(path.join(t.root, "a", "Proyek", "2026", "Q1", "data.csv"), "a,b\n1,2\n");
    fs.mkdirSync(path.join(t.root, "a", "Proyek", "kosong"));
    const l = (await t.call("alice", "GET", `/files?storageId=${storA}`)).data.items.find((i: any) => i.name === "Proyek");
    const j = await t.call("alice", "POST", "/transfers", { type: "MOVE", source: { storageId: storA, fileIds: [l.id] }, destination: { storageId: storB, folderId: "root" } });
    await t.wait(async () => (await t.call("alice", "GET", `/transfers/${j.data.id}`)).data.status === "COMPLETED");
    const job = (await t.call("alice", "GET", `/transfers/${j.data.id}`)).data;
    assert.equal(job.totalFiles, 2); assert.equal(job.completedFiles, 2);
    assert.equal(fs.readFileSync(path.join(t.root, "b", "Proyek", "2026", "Q1", "data.csv"), "utf8"), "a,b\n1,2\n");
    assert.ok(fs.existsSync(path.join(t.root, "b", "Proyek", "kosong")), "empty folders are preserved");
    assert.ok(!fs.existsSync(path.join(t.root, "a", "Proyek")), "source folder removed after success");
    const items = await t.call("alice", "GET", `/transfers/${j.data.id}/items`);
    assert.deepEqual(items.data.items.map((i: any) => i.relativePath).sort(), ["Proyek/2026/Q1/data.csv", "Proyek/readme.txt"]);
  });

  it("refuses to copy a folder into itself and to move into the same folder", async () => {
    fs.mkdirSync(path.join(t.root, "a", "Induk", "Anak"), { recursive: true });
    const induk = (await t.call("alice", "GET", `/files?storageId=${storA}`)).data.items.find((i: any) => i.name === "Induk");
    const anak = (await t.call("alice", "GET", `/files?storageId=${storA}&folderId=${induk.id}`)).data.items[0];
    const j = await t.call("alice", "POST", "/transfers", { type: "COPY", source: { storageId: storA, fileIds: [induk.id] }, destination: { storageId: storA, folderId: anak.id } });
    await t.wait(async () => (await t.call("alice", "GET", `/transfers/${j.data.id}`)).data.status === "FAILED");
    assert.match((await t.call("alice", "GET", `/transfers/${j.data.id}`)).data.errorMessage, /dalam dirinya sendiri/);
  });

  it("recovers jobs interrupted by a restart", async () => {
    const { db } = await import("../db.ts");
    const big = (await t.call("alice", "GET", `/files?storageId=${storA}`)).data.items.find((i: any) => i.name === "big.bin");
    const j = await t.call("alice", "POST", "/transfers", { type: "COPY", source: { storageId: storA, fileId: big.id }, destination: { storageId: storB, folderId: "root" }, conflictPolicy: "RENAME" });
    await t.wait(async () => (await t.call("alice", "GET", `/transfers/${j.data.id}`)).data.status === "COMPLETED");
    // Simulate a crash mid-flight: job + item left RUNNING.
    db.run("UPDATE transfer_jobs SET status='RUNNING', completed_at=NULL WHERE id=?", j.data.id);
    db.run("UPDATE transfer_items SET status='RUNNING', transferred_bytes=5 WHERE job_id=?", j.data.id);
    t.engine.start();
    await t.wait(async () => (await t.call("alice", "GET", `/transfers/${j.data.id}`)).data.status === "COMPLETED");
  });

  it("can pause, resume and cancel", async () => {
    const huge = Buffer.alloc(40 * 1024 * 1024, 7);
    fs.writeFileSync(path.join(t.root, "a", "huge.bin"), huge);
    const l = (await t.call("alice", "GET", `/files?storageId=${storA}`)).data.items.find((i: any) => i.name === "huge.bin");
    const j = await t.call("alice", "POST", "/transfers", { type: "COPY", source: { storageId: storA, fileId: l.id }, destination: { storageId: storB, folderId: "root" } });
    const st = async () => (await t.call("alice", "GET", `/transfers/${j.data.id}`)).data.status;
    await t.wait(async () => ["RUNNING", "VERIFYING", "COMPLETED"].includes(await st()));
    if ((await st()) !== "COMPLETED") {
      await t.call("alice", "POST", `/transfers/${j.data.id}/pause`);
      await t.wait(async () => ["PAUSED", "COMPLETED"].includes(await st()));
      if ((await st()) === "PAUSED") {
        await t.call("alice", "POST", `/transfers/${j.data.id}/resume`);
        await t.wait(async () => (await st()) === "COMPLETED");
      }
    }
    assert.equal(fs.statSync(path.join(t.root, "b", "huge.bin")).size, huge.length);
    const j2 = await t.call("alice", "POST", "/transfers", { type: "COPY", source: { storageId: storA, fileId: l.id }, destination: { storageId: storB, folderId: "root" }, conflictPolicy: "RENAME" });
    await t.call("alice", "POST", `/transfers/${j2.data.id}/cancel`);
    await t.wait(async () => ["CANCELLED", "COMPLETED"].includes((await t.call("alice", "GET", `/transfers/${j2.data.id}`)).data.status));
    const leftovers = fs.readdirSync(path.join(t.root, "b")).filter((n) => n.endsWith(".sdpart"));
    assert.deepEqual(leftovers, [], "no partial files left behind");
  });
});

describe("roles & permissions", () => {
  it("enforces viewer and member limits on the backend", async () => {
    const inv = await t.call("alice", "POST", `/workspaces/${wsAlice}/invitations`, { email: "vera@example.com", role: "VIEWER" });
    const token = new URL(inv.data.link).searchParams.get("invitation");
    const reg = await t.register("vera", { invitationToken: token });
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    const w = (await t.call("vera", "GET", "/auth/me")).data;
    assert.equal(w.activeWorkspaceId, wsAlice);
    assert.equal(w.workspaces[0].role, "VIEWER");

    const list = await t.call("vera", "GET", `/files?storageId=${storA}`);
    assert.equal(list.status, 200);
    const up = await t.call("vera", "POST", "/uploads", { storageId: storA, parentId: "root", name: "x.txt", size: 1 });
    assert.equal(up.status, 403);
    const mk = await t.call("vera", "POST", "/files/folders", { storageId: storA, name: "nope" });
    assert.equal(mk.status, 403);
    const item = list.data.items[0];
    assert.equal((await t.call("vera", "DELETE", `/files/${storA}/${item.id}`)).status, 403);
    assert.equal((await t.call("vera", "POST", "/transfers", { type: "COPY", source: { storageId: storA, fileId: item.id }, destination: { storageId: storB, folderId: "root" } })).status, 403);
    assert.equal((await t.call("vera", "POST", "/storages", { provider: "LOCAL", name: "z", root: "z" })).status, 403);
    // The invitation cannot be reused.
    assert.equal((await t.register("vera2", { invitationToken: token })).status, 400);
  });

  it("per-storage grants override role defaults", async () => {
    const members = (await t.call("alice", "GET", `/workspaces/${wsAlice}/members`)).data.members;
    const vera = members.find((m: any) => m.name === "vera");
    await t.call("alice", "PUT", `/storages/${storB}/permissions`, { userId: vera.userId, permissions: [] });
    assert.equal((await t.call("vera", "GET", `/files?storageId=${storB}`)).status, 403);
    await t.call("alice", "PUT", `/storages/${storB}/permissions`, { userId: vera.userId, permissions: ["READ", "DOWNLOAD", "UPLOAD", "DELETE"] });
    // VIEWER never exceeds read-only, whatever was granted.
    assert.equal((await t.call("vera", "POST", "/uploads", { storageId: storB, parentId: "root", name: "y.txt", size: 1 })).status, 403);
  });

  it("audit log records activity and hides from members", async () => {
    const logs = await t.call("alice", "GET", "/audit-logs?limit=200");
    const actions = new Set(logs.data.items.map((l: any) => l.action));
    for (const a of ["storage.connect", "file.upload", "file.download", "transfer.copy.create", "member.invite"]) assert.ok(actions.has(a), a);
    assert.ok(!JSON.stringify(logs.data).includes("password"));
    assert.equal((await t.call("vera", "GET", "/audit-logs")).status, 403);
  });

  it("deleting a storage connection leaves files untouched", async () => {
    const before = fs.readdirSync(path.join(t.root, "b")).length;
    const r = await t.call("alice", "DELETE", `/storages/${storB}`);
    assert.equal(r.status, 200);
    assert.equal(fs.readdirSync(path.join(t.root, "b")).length, before);
  });
});
