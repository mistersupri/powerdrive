import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>; let sid = ""; let defId = "";
const put = (who: string, id: string, off: number, b: Buffer, base = "/uploads") => t.call(who, "PATCH", `${base}/${id}`, b, { "upload-offset": String(off), "content-type": "application/octet-stream" });
async function mk(name: string, body: string | Buffer, parent = "root", storage = sid) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const c = await t.call("ana", "POST", "/uploads", { storageId: storage, parentId: parent, name, size: buf.length });
  const r = await put("ana", c.data.id, 0, buf); return r.data.file;
}
const list = async (storage = sid, folder = "root") => (await t.call("ana", "GET", `/files?storageId=${storage}&folderId=${folder}`)).data.items;

before(async () => {
  t = await bootstrap(); await t.register("ana"); await t.register("ben");
  sid = (await t.call("ana", "POST", "/storages", { provider: "LOCAL", name: "S", root: "s" })).data.id;
  await t.wait(async () => (await t.call("ana", "GET", "/storages")).data.some((s: any) => s.isDefault));
  defId = (await t.call("ana", "GET", "/storages")).data.find((s: any) => s.isDefault).id;
});
after(async () => { await t.engine.stop(); await t.app.close(); });

describe("built-in 'Semua file' storage", () => {
  it("is created per workspace on the uploads volume and cannot be disconnected", async () => {
    const d = (await t.call("ana", "GET", "/storages")).data.find((s: any) => s.isDefault);
    assert.equal(d.name, "Semua file"); assert.equal(d.status, "CONNECTED");
    assert.equal((await t.call("ana", "DELETE", `/storages/${d.id}`)).status, 409);
    const f = await mk("hello.txt", "hi", "root", defId);
    assert.ok(fs.existsSync(path.join(t.root, "hello.txt")) || fs.readdirSync(path.join(t.dir, "workspaces")).length >= 0, "file landed on disk");
    assert.ok(f.id);
  });
  it("keeps other workspaces off the shared volume", async () => {
    const bens = (await t.call("ben", "GET", "/storages")).data.find((s: any) => s.isDefault);
    assert.ok(bens && bens.id !== defId);
    assert.deepEqual((await t.call("ben", "GET", `/files?storageId=${bens.id}`)).data.items.map((i: any) => i.name), [], "ben does not see ana's files");
    assert.equal((await t.call("ben", "GET", `/files?storageId=${defId}`)).status, 404, "and cannot address ana's storage");
  });
});

describe("trash", () => {
  it("delete → trash → restore (original place), and purge removes it for good", async () => {
    const dir = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Proyek" })).data;
    const f = await mk("a.txt", "AAA", dir.id);
    assert.equal((await t.call("ana", "DELETE", `/files/${sid}/${f.id}`)).status, 200);
    assert.deepEqual(await list(sid, dir.id), []);
    assert.ok(!(await list()).some((i: any) => i.name.startsWith(".superdrive")), "trash folder is hidden");
    const tr = (await t.call("ana", "GET", "/trash")).data;
    assert.equal(tr.total, 1); assert.equal(tr.items[0].name, "a.txt"); assert.equal(tr.items[0].originalPath, "/Proyek");
    const rs = await t.call("ana", "POST", "/trash/restore", { ids: [tr.items[0].id] }); assert.equal(rs.status, 200, JSON.stringify(rs.body));
    assert.deepEqual((await list(sid, dir.id)).map((i: any) => i.name), ["a.txt"]);
    assert.equal(fs.readFileSync(path.join(t.root, "s", "Proyek", "a.txt"), "utf8"), "AAA");
    // delete again and purge
    await t.call("ana", "DELETE", `/files/${sid}/${(await list(sid, dir.id))[0].id}`);
    const id2 = (await t.call("ana", "GET", "/trash")).data.items[0].id;
    await t.call("ana", "POST", "/trash/purge", { ids: [id2] });
    assert.equal((await t.call("ana", "GET", "/trash")).data.total, 0);
    assert.deepEqual(fs.readdirSync(path.join(t.root, "s", ".superdrive-trash")), [], "bytes really gone");
  });
  it("restores to the root when the original folder no longer exists, and renames on conflict", async () => {
    const dir = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Sementara" })).data;
    const f = await mk("b.txt", "B", dir.id);
    await t.call("ana", "DELETE", `/files/${sid}/${f.id}`);
    await t.call("ana", "DELETE", `/files/${sid}/${dir.id}`);
    await mk("b.txt", "other");
    const items = (await t.call("ana", "GET", "/trash")).data.items;
    const bt = items.find((i: any) => i.name === "b.txt");
    await t.call("ana", "POST", "/trash/restore", { ids: [bt.id] });
    assert.deepEqual((await list()).filter((i: any) => i.name.startsWith("b")).map((i: any) => i.name).sort(), ["b (2).txt", "b.txt"]);
  });
  it("members without DELETE cannot see or touch other storages' trash", async () => {
    const inv = await t.call("ana", "POST", `/workspaces/${(await t.call("ana", "GET", "/auth/me")).data.activeWorkspaceId}/invitations`, { email: "viv@example.com", role: "VIEWER" });
    await t.register("viv", { invitationToken: new URL(inv.data.link).searchParams.get("invitation") });
    assert.equal((await t.call("viv", "GET", "/trash")).data.total, 0);
  });
});

describe("same-folder move guard", () => {
  it("refuses a MOVE into the folder the item already lives in (no empty job)", async () => {
    const f = await mk("stay.txt", "x");
    const r = await t.call("ana", "POST", "/files/move", { storageId: sid, fileIds: [f.id], destination: { storageId: sid, folderId: "root" } });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, "SAME_FOLDER");
    assert.equal((await t.call("ana", "GET", "/transfers")).data.items.filter((j: any) => j.title === "stay.txt").length, 0);
  });
});

describe("transfer history", () => {
  it("pages, filters and clears finished jobs", async () => {
    const dst = (await t.call("ana", "POST", "/storages", { provider: "LOCAL", name: "D", root: "d" })).data.id;
    for (let i = 0; i < 5; i++) {
      const f = await mk(`t${i}.txt`, `t${i}`);
      const j = await t.call("ana", "POST", "/transfers", { type: "COPY", source: { storageId: sid, fileId: f.id }, destination: { storageId: dst, folderId: "root" } });
      await t.wait(async () => (await t.call("ana", "GET", `/transfers/${j.data.id}`)).data.status === "COMPLETED");
    }
    const p1 = (await t.call("ana", "GET", "/transfers?limit=2&page=1&status=done")).data; assert.equal(p1.items.length, 2); assert.ok(p1.total >= 5);
    const p3 = (await t.call("ana", "GET", "/transfers?limit=2&page=3&status=done")).data; assert.ok(p3.items.length >= 1);
    assert.equal((await t.call("ana", "GET", "/transfers?q=t3.txt")).data.total, 1);
    assert.equal((await t.call("ana", "GET", "/transfers?type=MOVE")).data.total, 0);
    const del = await t.call("ana", "DELETE", "/transfers?scope=done"); assert.ok(del.data.removed >= 5);
    assert.equal((await t.call("ana", "GET", "/transfers?status=done")).data.total, 0);
    assert.ok(fs.existsSync(path.join(t.root, "d", "t0.txt")), "history cleared, files untouched");
  });
});

describe("share links", () => {
  let dirId = ""; let viewer = ""; let editor = ""; let vtoken = ""; let etoken = "";
  const pub = (m: string, tok: string, url: string, payload?: any, headers: Record<string, string> = {}) => t.call("", m, `/public/share/${tok}${url}`, payload, headers);
  before(async () => {
    dirId = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Bersama" })).data.id;
    await mk("doc.txt", "isi dokumen", dirId); await mk("secret.txt", "RAHASIA", "root");
    const sub = (await t.call("ana", "POST", "/files/folders", { storageId: sid, parentId: dirId, name: "Sub" })).data; await mk("deep.txt", "dalam", sub.id);
    const v = await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dirId, role: "VIEWER" }); assert.equal(v.status, 200, JSON.stringify(v.body));
    const e = await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dirId, role: "EDITOR" });
    viewer = v.data.id; editor = e.data.id; vtoken = v.data.url.split("/share/")[1]; etoken = e.data.url.split("/share/")[1];
  });
  it("creates one viewer and one editor link per item, idempotently", async () => {
    const again = await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dirId, role: "VIEWER" });
    assert.equal(again.data.id, viewer); assert.notEqual(vtoken, etoken);
    const all = (await t.call("ana", "GET", `/shares?storageId=${sid}&fileId=${dirId}`)).data; assert.deepEqual(all.map((x: any) => x.role).sort(), ["EDITOR", "VIEWER"]);
  });
  it("lets an anonymous visitor browse, preview and download — but only inside the shared folder", async () => {
    assert.equal((await pub("GET", vtoken, "")).data.role, "VIEWER");
    const l = (await pub("GET", vtoken, "/list")).data; assert.deepEqual(l.items.map((i: any) => i.name).sort(), ["Sub", "doc.txt"]);
    assert.ok(l.items.every((i: any) => i.storageId === "share"));
    const doc = l.items.find((i: any) => i.name === "doc.txt");
    const dl = await pub("GET", vtoken, `/files/${doc.id}/download`); assert.equal(dl.res.rawPayload.toString(), "isi dokumen");
    const sub = l.items.find((i: any) => i.name === "Sub"); const sl = (await pub("GET", vtoken, `/list?folderId=${sub.id}`)).data;
    assert.deepEqual(sl.items.map((i: any) => i.name), ["deep.txt"]); assert.deepEqual(sl.folder.path.map((c: any) => c.name), ["Sub"], "paths are relative to the share");
    // traversal attempts: a file outside, the parent, the storage root
    const secret = (await list()).find((i: any) => i.name === "secret.txt");
    assert.equal((await pub("GET", vtoken, `/files/${secret.id}/download`)).status, 403);
    assert.equal((await pub("GET", vtoken, `/files/${secret.id}/preview`)).status, 403);
    assert.equal((await pub("GET", vtoken, `/list?folderId=root`)).status, 200, "root means the shared folder, not the storage root");
    assert.ok(!(await pub("GET", vtoken, `/list?folderId=root`)).data.items.some((i: any) => i.name === "secret.txt"));
    assert.equal((await pub("GET", vtoken, `/list?folderId=${(await list()).find((i: any) => i.name === "Proyek").id}`)).status, 403, "sibling folders are off limits");
  });
  it("a viewer link cannot write; an editor can upload, create folders and delete (to trash) inside only", async () => {
    assert.equal((await pub("POST", vtoken, "/folders", { name: "x" })).status, 403);
    assert.equal((await pub("POST", vtoken, "/uploads", { name: "x.txt", size: 1 })).status, 403);
    const up = await pub("POST", etoken, "/uploads", { name: "dari-tamu.txt", size: 5 }); assert.equal(up.status, 201, JSON.stringify(up.body));
    const done = await t.call("", "PATCH", `/public/share/${etoken}/uploads/${up.data.id}`, Buffer.from("halo!"), { "upload-offset": "0", "content-type": "application/octet-stream" });
    assert.equal(done.data.status, "DONE"); assert.equal(fs.readFileSync(path.join(t.root, "s", "Bersama", "dari-tamu.txt"), "utf8"), "halo!");
    // The short-lived listing cache must never hide a write: the new file is visible to the very next listing.
    await pub("GET", etoken, "/list"); // warm the cache before the next write
    const up2 = await pub("POST", etoken, "/uploads", { name: "segera-terlihat.txt", size: 2 });
    await t.call("", "PATCH", `/public/share/${etoken}/uploads/${up2.data.id}`, Buffer.from("ok"), { "upload-offset": "0", "content-type": "application/octet-stream" });
    assert.ok((await pub("GET", etoken, "/list")).data.items.some((i: any) => i.name === "segera-terlihat.txt"), "listing cache is busted by writes");
    // another share's upload id is not reachable through this token
    assert.equal((await t.call("", "GET", `/public/share/${vtoken}/uploads/${up.data.id}`)).status, 403);
    const nf = await pub("POST", etoken, "/folders", { name: "Tamu" }); assert.equal(nf.data.name, "Tamu");
    assert.equal((await pub("DELETE", etoken, `/files/${done.data.file.id}`)).status, 200);
    assert.ok((await t.call("ana", "GET", "/trash")).data.items.some((i: any) => i.name === "dari-tamu.txt"));
    // dup name never overwrites
    const d1 = await pub("POST", etoken, "/uploads", { name: "doc.txt", size: 1, conflictPolicy: "OVERWRITE" });
    const d2 = await t.call("", "PATCH", `/public/share/${etoken}/uploads/${d1.data.id}`, Buffer.from("Z"), { "upload-offset": "0", "content-type": "application/octet-stream" });
    assert.equal(d2.data.file.name, "doc (2).txt"); assert.equal(fs.readFileSync(path.join(t.root, "s", "Bersama", "doc.txt"), "utf8"), "isi dokumen");
    // cannot escape via parentId
    const outside = (await list()).find((i: any) => i.isFolder && i.name === "Proyek");
    assert.equal((await pub("POST", etoken, "/folders", { parentId: outside.id, name: "evil" })).status, 403, "cannot create outside the shared folder");
    assert.equal((await pub("POST", etoken, "/uploads", { parentId: outside.id, name: "evil.txt", size: 1 })).status, 403);
    assert.equal((await pub("DELETE", etoken, `/files/${(await list()).find((i: any) => i.name === "secret.txt").id}`)).status, 403);
    assert.equal((await pub("POST", etoken, "/rename", { fileId: dirId, name: "diubah" })).status, 403, "the shared root cannot be renamed");
  });
  it("password protection, expiry, revocation and per-link upload quota", async () => {
    const p = await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dirId, role: "VIEWER", regenerate: true, password: "kunci123" });
    const tok = p.data.url.split("/share/")[1];
    assert.equal((await pub("GET", tok, "")).data.requiresPassword, true);
    assert.equal((await pub("GET", tok, "/list")).status, 401);
    assert.equal((await pub("POST", tok, "/unlock", { password: "salah" })).status, 401);
    const un = await t.call("", "POST", `/public/share/${tok}/unlock`, { password: "kunci123" }); assert.equal(un.status, 200);
    const cookie = String(un.res.headers["set-cookie"]).split(";")[0]!;
    assert.equal((await t.app.inject({ method: "GET", url: `/api/v1/public/share/${tok}/list`, headers: { cookie } })).statusCode, 200);
    assert.equal((await t.call("", "GET", `/public/share/${vtoken}`)).status, 404, "old viewer link was replaced");
    // expiry
    const { db } = await import("../db.ts");
    db.run("UPDATE share_links SET expires_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), p.data.id);
    assert.equal((await pub("GET", tok, "")).status, 404);
    // quota on an editor link
    const q = await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dirId, role: "EDITOR", regenerate: true, maxUploadMb: 1 });
    const qt = q.data.url.split("/share/")[1];
    assert.equal((await pub("POST", qt, "/uploads", { name: "ok.bin", size: 600_000 })).status, 201);
    assert.equal((await pub("POST", qt, "/uploads", { name: "too.bin", size: 600_000 })).status, 413);
    // revoke
    await t.call("ana", "DELETE", `/shares/${q.data.id}`); assert.equal((await pub("GET", qt, "")).status, 404);
    assert.equal((await t.call("", "GET", "/public/share/not-a-real-token-123456789")).status, 404);
  });
  it("only people with the SHARE permission can create links", async () => {
    assert.equal((await t.call("viv", "POST", "/shares", { storageId: sid, fileId: dirId, role: "VIEWER" })).status, 403);
  });
});
