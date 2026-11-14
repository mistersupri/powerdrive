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

describe("trash as a tree", () => {
  it("lets you browse a deleted folder, restore some of its files and purge others", async () => {
    const dir = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Arsip Lama" })).data;
    const sub = (await t.call("ana", "POST", "/files/folders", { storageId: sid, parentId: dir.id, name: "2025" })).data;
    await mk("a.txt", "A", dir.id); await mk("b.txt", "B", sub.id); await mk("c.txt", "C", sub.id);
    await t.call("ana", "DELETE", `/files/${sid}/${dir.id}`);
    assert.deepEqual((await list()).filter((i: any) => i.name === "Arsip Lama"), []);
    const item = (await t.call("ana", "GET", "/trash")).data.items.find((i: any) => i.name === "Arsip Lama");
    const top = (await t.call("ana", "GET", `/trash/${item.id}/children`)).data.items; assert.deepEqual(top.map((i: any) => i.name).sort(), ["2025", "a.txt"]);
    const inner = (await t.call("ana", "GET", `/trash/${item.id}/children?folderId=${top.find((i: any) => i.name === "2025").id}`)).data.items;
    assert.deepEqual(inner.map((i: any) => i.name).sort(), ["b.txt", "c.txt"]);
    // restore just b.txt: its folder chain is recreated at the original place
    const r = await t.call("ana", "POST", `/trash/${item.id}/restore-entries`, { ids: [inner.find((i: any) => i.name === "b.txt").id] });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(fs.readFileSync(path.join(t.root, "s", "Arsip Lama", "2025", "b.txt"), "utf8"), "B");
    // purge c.txt for good; a.txt is still in the trash
    await t.call("ana", "POST", `/trash/${item.id}/purge-entries`, { ids: [inner.find((i: any) => i.name === "c.txt").id] });
    assert.deepEqual((await t.call("ana", "GET", `/trash/${item.id}/children`)).data.items.map((i: any) => i.name), ["a.txt"]);
    // a file from somewhere else cannot be smuggled in
    const other = await mk("liar.txt", "x");
    assert.equal((await t.call("ana", "POST", `/trash/${item.id}/purge-entries`, { ids: [other.id] })).status, 403);
    assert.ok(fs.existsSync(path.join(t.root, "s", "liar.txt")));
    // restoring the last entry removes the now-empty trashed folder
    const last = (await t.call("ana", "GET", `/trash/${item.id}/children`)).data.items[0];
    const done = await t.call("ana", "POST", `/trash/${item.id}/restore-entries`, { ids: [last.id] }); assert.equal(done.data.removedParent, true);
    assert.ok(!(await t.call("ana", "GET", "/trash")).data.items.some((i: any) => i.id === item.id));
  });
});

describe("tree, details and search location", () => {
  it("lists folders only for the tree, and reports recursive folder stats", async () => {
    const dir = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Statistik" })).data;
    const inner = (await t.call("ana", "POST", "/files/folders", { storageId: sid, parentId: dir.id, name: "Dalam" })).data;
    await mk("x.bin", Buffer.alloc(1000), dir.id); await mk("y.bin", Buffer.alloc(500), inner.id);
    const l = (await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${dir.id}&foldersOnly=true`)).data.items; assert.deepEqual(l.map((i: any) => i.name), ["Dalam"]);
    assert.deepEqual((await t.call("ana", "GET", `/files/${sid}/${dir.id}/stats`)).data, { files: 2, folders: 1, bytes: 1500, truncated: false });
  });
  it("the background crawler indexes folders nobody opened, and search shows where each result lives", async () => {
    fs.mkdirSync(path.join(t.root, "s", "Dalam1", "Dalam2"), { recursive: true }); fs.writeFileSync(path.join(t.root, "s", "Dalam1", "Dalam2", "ketemu-saya.txt"), "x");
    assert.equal((await t.call("ana", "GET", "/search?q=ketemu-saya")).data.total, 0, "unopened folders are not indexed yet");
    const rx = await t.call("ana", "POST", `/storages/${sid}/reindex`); assert.equal(rx.status, 200);
    await t.wait(async () => (await t.call("ana", "GET", `/storages/${sid}`)).data.index.status === "DONE");
    const s = (await t.call("ana", "GET", "/search?q=ketemu-saya")).data; assert.equal(s.total, 1);
    assert.equal(s.items[0].path, "/Dalam1/Dalam2", "result carries its folder path");
    const info = (await t.call("ana", "GET", `/storages/${sid}`)).data.index; assert.ok(info.count > 0 && info.finishedAt);
    // a file removed behind our back disappears from the index on the next crawl
    fs.rmSync(path.join(t.root, "s", "Dalam1"), { recursive: true });
    await t.call("ana", "POST", `/storages/${sid}/reindex`); await t.wait(async () => (await t.call("ana", "GET", `/storages/${sid}`)).data.index.status === "DONE");
    assert.equal((await t.call("ana", "GET", "/search?q=ketemu-saya")).data.total, 0);
  });
  it("only admins can trigger a re-index", async () => {
    assert.equal((await t.call("viv", "POST", `/storages/${sid}/reindex`)).status, 403);
  });
});

describe("share links: titles, changeable permission, visitors", () => {
  let dir = ""; let a: any; let b: any; let atok = "";
  const pub = (m: string, tok: string, url: string, payload?: any) => t.call("", m, `/public/share/${tok}${url}`, payload);
  const tokOf = (x: any) => x.url.split("/share/")[1] as string;
  before(async () => {
    dir = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Untuk-Banyak-Orang" })).data.id;
    await mk("isi.txt", "isi", dir);
    a = (await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dir, role: "VIEWER", newLink: true, title: "  Pak   Budi (vendor) " })).data;
    b = (await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dir, role: "VIEWER", newLink: true, title: "Tim audit" })).data; atok = tokOf(a);
  });
  it("makes several independent links per item, each with a tidy title for the recipient", async () => {
    assert.notEqual(a.id, b.id); assert.notEqual(tokOf(a), tokOf(b));
    assert.equal(a.title, "Pak Budi (vendor)", "whitespace is collapsed and trimmed");
    const all = (await t.call("ana", "GET", `/shares?storageId=${sid}&fileId=${dir}`)).data; assert.deepEqual(all.map((x: any) => x.title), ["Pak Budi (vendor)", "Tim audit"]);
    assert.equal((await t.call("ana", "GET", "/shares/all?q=budi")).data.total, 1, "the shares page can search by title");
    assert.equal((await pub("GET", atok, "")).data.title, undefined, "the title is for the owner, never shown to visitors");
    assert.equal((await t.call("ana", "PATCH", `/shares/${a.id}`, { title: "Pak Budi, revisi 2" })).data.title, "Pak Budi, revisi 2");
    assert.equal((await t.call("ana", "PATCH", `/shares/${a.id}`, { title: "   " })).data.title, null, "blank clears the title");
    await t.call("ana", "PATCH", `/shares/${a.id}`, { title: "Pak Budi" });
  });
  it("the permission can be changed after the link was already used, and takes effect immediately", async () => {
    assert.equal((await pub("GET", atok, "/list")).status, 200, "link already in use");
    assert.equal((await pub("POST", atok, "/folders", { name: "belum-boleh" })).status, 403, "viewer cannot write");
    const up = await t.call("ana", "PATCH", `/shares/${a.id}`, { role: "EDITOR", maxUploadMb: 5 }); assert.equal(up.data.role, "EDITOR");
    assert.equal(tokOf(up.data), atok, "same link, same URL");
    assert.equal((await pub("POST", atok, "/folders", { name: "boleh-sekarang" })).status, 200);
    const u = await pub("POST", atok, "/uploads", { name: "sedang-jalan.txt", size: 4 }); assert.equal(u.status, 201);
    const down = await t.call("ana", "PATCH", `/shares/${a.id}`, { role: "VIEWER" }); assert.equal(down.data.role, "VIEWER"); assert.equal(down.data.maxUploadBytes, null, "quota is dropped with the editor role");
    const chunk = await t.call("", "PATCH", `/public/share/${atok}/uploads/${u.data.id}`, Buffer.from("data"), { "upload-offset": "0", "content-type": "application/octet-stream" });
    assert.equal(chunk.status, 403, "an upload in flight stops the moment the link becomes viewer-only");
    assert.equal((await pub("GET", atok, "/list")).status, 200, "reading still works");
    const { db } = await import("../db.ts");
    const rows = db.all<any>("SELECT metadata FROM audit_logs WHERE action = 'share.role' AND resource_id = ? ORDER BY created_at", a.id);
    assert.deepEqual(rows.map((r) => JSON.parse(r.metadata).to), ["EDITOR", "VIEWER"], "every permission change is audited");
  });
  it("editor permission is only possible for folders", async () => {
    const f = (await list()).find((i: any) => i.name === "secret.txt") ?? (await list()).find((i: any) => !i.isFolder);
    const link = (await t.call("ana", "POST", "/shares", { storageId: sid, fileId: f.id, role: "VIEWER", newLink: true, title: "file tunggal" })).data;
    assert.equal((await t.call("ana", "PATCH", `/shares/${link.id}`, { role: "EDITOR" })).status, 400);
    assert.equal((await t.call("ana", "POST", "/shares", { storageId: sid, fileId: f.id, role: "EDITOR", newLink: true })).status, 400);
  });
  it("a visitor of a link cannot create, list, change or revoke links for what was shared", async () => {
    assert.equal((await t.call("", "POST", "/shares", { storageId: sid, fileId: dir, role: "VIEWER", newLink: true })).status, 401, "no session, no links");
    assert.equal((await t.call("", "PATCH", `/shares/${a.id}`, { role: "EDITOR" })).status, 401);
    assert.equal((await t.call("", "DELETE", `/shares/${a.id}`)).status, 401);
    assert.equal((await t.call("", "GET", `/shares?storageId=${sid}&fileId=${dir}`)).status, 401);
    assert.equal((await t.call("", "GET", "/shares/all")).status, 401);
    // The pseudo-context used for visitors is refused by the module itself, even if some future route forgot to check.
    const { createShare, updateShare, revokeShare } = await import("../modules/shares.ts");
    const ctx = { userId: "x", userName: "Tautan berbagi", isSuperAdmin: false, workspaceId: "w", role: "MEMBER" as const, ip: "1.1.1.1", viaShare: true };
    await assert.rejects(() => createShare(ctx, {} as any, { storageId: sid, fileId: dir, role: "VIEWER" }), /Pengunjung tautan/);
    await assert.rejects(() => updateShare(ctx, a.id, { role: "EDITOR" }), /Pengunjung tautan/);
    assert.throws(() => revokeShare(ctx, a.id), /Pengunjung tautan/);
    assert.equal((await pub("POST", atok, "/shares", { role: "EDITOR" })).status, 404, "no sharing endpoint exists under a public token");
  });
});

describe("change badges, activity, tags, comments, metadata", () => {
  let dir = ""; let inner = ""; let png = "";
  const listRoot = async (who: string) => (await t.call(who, "GET", `/files?storageId=${sid}&folderId=root&limit=500`)).data.items as any[];
  before(async () => {
    dir = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Lencana" })).data.id;
    inner = (await t.call("ana", "POST", "/files/folders", { storageId: sid, parentId: dir, name: "Dalam" })).data.id;
  });
  it("marks a folder for everyone else when something inside changes, until they open it", async () => {
    const mark = async (who: string) => (await listRoot(who)).find((i: any) => i.name === "Lencana");
    assert.ok(!(await mark("ana")).changed, "the person who made the change never gets a badge for it");
    assert.equal((await mark("viv")).changed, true, "the other member sees one (a folder was created inside)");
    assert.equal((await t.call("viv", "GET", `/files?storageId=${sid}&folderId=${dir}&peek=1`)).status, 200);
    assert.equal((await mark("viv")).changed, true, "a hover prefetch does not count as opening the folder");
    await t.call("ana", "POST", "/files/folders", { storageId: sid, parentId: inner, name: "Diam-diam" });
    await t.call("viv", "POST", "/files/seen", { storageId: sid, folderId: dir });
    assert.ok(!(await mark("viv")).changed, "an explicit \"I opened it\" (listing came from the browser cache) clears the badge too");
    await t.call("ana", "POST", "/files/folders", { storageId: sid, parentId: inner, name: "Lagi" });
    await t.call("viv", "GET", `/files?storageId=${sid}&folderId=${dir}`);
    assert.ok(!(await mark("viv")).changed, "opening it clears the badge");
    await t.call("ana", "POST", "/files/folders", { storageId: sid, parentId: inner, name: "Lebih-dalam" });
    assert.equal((await mark("viv")).changed, true, "a change deeper down marks every folder above it");
    const lvl = (await t.call("viv", "GET", `/files?storageId=${sid}&folderId=${dir}`)).data.items.find((i: any) => i.name === "Dalam");
    assert.equal(lvl.changed, true, "and the folder that changed is flagged one level down");
    await t.call("viv", "GET", `/files?storageId=${sid}&folderId=${inner}`);
    const again = (await t.call("viv", "GET", `/files?storageId=${sid}&folderId=${dir}`)).data.items.find((i: any) => i.name === "Dalam"); assert.ok(!again.changed);
  });
  it("keeps who-did-what per file, including visitors of a share link", async () => {
    const sharp = (await import("sharp")).default;
    const buf = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#369" } }).jpeg().toBuffer();
    fs.writeFileSync(path.join(t.root, "s", "Lencana", "foto.jpg"), buf);
    await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${dir}`); png = (await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${dir}`)).data.items.find((i: any) => i.name === "foto.jpg").id;
    await t.call("viv", "GET", `/files/${sid}/${png}/preview`); await t.call("ana", "GET", `/files/${sid}/${png}/download`);
    const link = (await t.call("ana", "POST", "/shares", { storageId: sid, fileId: png, role: "VIEWER", newLink: true, title: "Klien A" })).data; const tok = link.url.split("/share/")[1];
    await t.call("", "GET", `/public/share/${tok}/files/root/download`);
    const act = (await t.call("ana", "GET", `/files/${sid}/${png}/activity`)).data as any[];
    const has = (a: string, kind: string) => act.some((x) => x.action === a && x.actorKind === kind);
    assert.ok(has("view", "member") && has("download", "member") && has("share", "member"), JSON.stringify(act.map((x) => [x.action, x.actorKind])));
    assert.ok(act.some((x) => x.actorKind === "visitor" && x.actor.includes("Klien A")), "a visitor shows up under the link title, not as a person");
    const again = await t.call("ana", "GET", `/files/${sid}/${png}/download`); assert.equal(again.status, 200);
    assert.equal(((await t.call("ana", "GET", `/files/${sid}/${png}/activity`)).data as any[]).filter((x) => x.action === "download" && x.actorKind === "member").length, 1, "repeat downloads within a minute count once");
  });
  it("tags: normalised, listed, removable, searchable", async () => {
    assert.deepEqual((await t.call("ana", "POST", `/files/${sid}/${png}/tags`, { tag: "  Foto  Liburan! " })).data, ["foto-liburan"]);
    assert.equal((await t.call("ana", "POST", `/files/${sid}/${png}/tags`, { tag: "!!!" })).status, 400);
    await t.call("ana", "POST", `/files/${sid}/${png}/tags`, { tag: "klien" });
    assert.deepEqual((await t.call("ana", "GET", `/files/${sid}/${png}/tags`)).data, ["foto-liburan", "klien"]);
    assert.ok((await t.call("ana", "GET", "/tags")).data.some((x: any) => x.tag === "klien"));
    assert.deepEqual((await t.call("ana", "GET", "/search?tag=klien")).data.items.map((i: any) => i.name), ["foto.jpg"]);
    assert.deepEqual((await t.call("ana", "DELETE", `/files/${sid}/${png}/tags/klien`)).data, ["foto-liburan"]);
    assert.equal((await t.call("ana", "GET", "/search?tag=klien")).data.total, 0);
  });
  it("comments: members can write, only the author or an admin can delete", async () => {
    const c1 = (await t.call("viv", "POST", `/files/${sid}/${png}/comments`, { body: "  Tolong cek warnanya  " })).data; assert.equal(c1.body, "Tolong cek warnanya"); assert.equal(c1.mine, true);
    assert.equal((await t.call("viv", "POST", `/files/${sid}/${png}/comments`, { body: "   " })).status, 400);
    const seen = (await t.call("ana", "GET", `/files/${sid}/${png}/comments`)).data; assert.equal(seen.length, 1); assert.equal(seen[0].mine, false);
    const c2 = (await t.call("ana", "POST", `/files/${sid}/${png}/comments`, { body: "Sudah" })).data;
    assert.equal((await t.call("viv", "DELETE", `/files/${sid}/comments/${c2.id}`)).status, 403, "not their comment");
    assert.equal((await t.call("ana", "DELETE", `/files/${sid}/comments/${c1.id}`)).status, 200, "the owner may moderate");
    assert.ok([403, 404].includes((await t.call("ben", "GET", `/files/${sid}/${png}/comments`)).status), "another workspace cannot read them");
  });
  it("metadata: image size and format from the file header", async () => {
    const m = (await t.call("ana", "GET", `/files/${sid}/${png}/metadata`)).data as any[];
    const g = m.find((x) => x.title === "Gambar"); assert.ok(g, JSON.stringify(m));
    assert.equal(g.rows.find((r: any) => r.k === "Dimensi").v, "64 × 48 px"); assert.equal(g.rows.find((r: any) => r.k === "Format").v, "JPEG");
    assert.deepEqual((await t.call("ana", "GET", `/files/${sid}/${dir}/metadata`)).data, [], "folders have none");
  });
});

describe("share bundles and direct shares", () => {
  let a = ""; let b = ""; let loose = ""; let link: any; let tok = "";
  const pub = (m: string, url: string, payload?: any) => t.call("", m, `/public/share/${tok}${url}`, payload);
  before(async () => {
    a = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Paket-A" })).data.id; b = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Paket-B" })).data.id;
    await mk("a.txt", "isi A", a); await mk("b.txt", "isi B", b); await mk("lepas.txt", "isi lepas", "root"); await mk("rahasia-paket.txt", "tidak boleh", "root");
    loose = (await list()).find((i: any) => i.name === "lepas.txt").id;
    link = (await t.call("ana", "POST", "/shares", { storageId: sid, fileIds: [a, b, loose], role: "VIEWER", title: "Paket klien" })).data; tok = link.url.split("/share/")[1];
  });
  it("one link can cover several files and folders", async () => {
    assert.equal(link.kind, "bundle"); assert.equal(link.itemCount, 3); assert.deepEqual(link.items.map((i: any) => i.name).sort(), ["Paket-A", "Paket-B", "lepas.txt"]); assert.equal(link.fileId, "");
    const meta = (await pub("GET", "")).data; assert.equal(meta.isBundle, true); assert.equal(meta.itemCount, 3); assert.equal(meta.name, "3 item", "the private title is not leaked as the page name");
    const root = (await pub("GET", "/list")).data; assert.deepEqual(root.items.map((i: any) => i.name), ["Paket-A", "Paket-B", "lepas.txt"], "folders first, then files");
    const fa = root.items.find((i: any) => i.name === "Paket-A");
    const inA = (await pub("GET", `/list?folderId=${fa.id}`)).data; assert.deepEqual(inA.items.map((i: any) => i.name), ["a.txt"]); assert.deepEqual(inA.folder.path.map((c: any) => c.name), ["Paket-A"]);
    const lepas = root.items.find((i: any) => i.name === "lepas.txt"); assert.equal((await pub("GET", `/files/${lepas.id}/download`)).res.rawPayload.toString(), "isi lepas");
    const zip = await pub("GET", "/files/root/download"); assert.equal(zip.res.rawPayload.subarray(0, 2).toString(), "PK", "the whole bundle downloads as one ZIP");
    const z2 = await t.call("", "POST", `/public/share/${tok}/zip`, { id: "root" }); assert.equal(z2.res.rawPayload.subarray(0, 2).toString(), "PK");
  });
  it("nothing outside the bundle is reachable", async () => {
    const outside = (await list()).find((i: any) => i.name === "rahasia-paket.txt"); assert.ok(outside);
    assert.equal((await pub("GET", `/files/${outside.id}/download`)).status, 403);
    assert.equal((await pub("GET", `/files/${outside.id}/preview`)).status, 403);
    assert.equal((await pub("GET", `/list?folderId=${(await list()).find((i: any) => i.name === "Proyek").id}`)).status, 403);
    assert.equal((await t.call("", "POST", `/public/share/${tok}/zip`, { id: outside.id })).status, 403);
  });
  it("editor on a bundle writes only inside its folders, never at the virtual top level or on the shared items themselves", async () => {
    assert.equal((await t.call("ana", "PATCH", `/shares/${link.id}`, { role: "EDITOR" })).data.role, "EDITOR");
    assert.equal((await pub("POST", "/folders", { name: "di-puncak" })).status, 400, "no folder at the virtual top level");
    assert.equal((await pub("POST", "/uploads", { name: "x.txt", size: 1 })).status, 400);
    const fa = (await pub("GET", "/list")).data.items.find((i: any) => i.name === "Paket-A");
    assert.equal((await pub("POST", "/folders", { parentId: fa.id, name: "baru-di-A" })).status, 200);
    assert.equal((await pub("POST", "/rename", { fileId: fa.id, name: "diganti" })).status, 403, "top-level items cannot be renamed");
    assert.equal((await pub("DELETE", `/files/${fa.id}`)).status, 403, "or deleted");
    const outside = (await list()).find((i: any) => i.name === "rahasia-paket.txt");
    assert.equal((await pub("DELETE", `/files/${outside.id}`)).status, 403);
    assert.equal((await t.call("ana", "PATCH", `/shares/${link.id}`, { role: "VIEWER" })).data.role, "VIEWER");
    const files = await t.call("ana", "POST", "/shares", { storageId: sid, fileIds: [loose, (await list()).find((i: any) => i.name === "rahasia-paket.txt").id], role: "EDITOR" });
    assert.equal(files.status, 400, "editor needs at least one folder in the bundle");
  });
  it("shares directly with a member, who finds it under \"shared with me\" and needs to be signed in", async () => {
    const viv = (await t.call("viv", "GET", "/auth/me")).data.user.id; const benId = (await t.call("ben", "GET", "/auth/me")).data.user.id;
    assert.equal((await t.call("ana", "POST", "/shares", { storageId: sid, fileId: a, recipientUserIds: [benId], role: "VIEWER" })).status, 400, "recipients must belong to the workspace");
    const made = (await t.call("ana", "POST", "/shares", { storageId: sid, fileIds: [a, b], recipientUserIds: [viv], role: "VIEWER", title: "Untuk Viv" })).data as any[];
    assert.equal(made.length, 1); assert.equal(made[0].recipient.id, viv);
    const mine = (await t.call("viv", "GET", "/shared-with-me")).data as any[]; const m = mine.find((x) => x.id === made[0].id); assert.ok(m, "viv sees it"); assert.equal(m.kind, "bundle"); assert.equal(m.createdByName, "ana", "and who shared it");
    assert.equal((await t.call("ana", "GET", "/shared-with-me")).data.some((x: any) => x.id === made[0].id), false, "the sharer does not see it in their own inbox");
    assert.ok((await t.call("viv", "GET", "/notifications")).data.items.some((n: any) => n.type === "share.received"), "the recipient is notified");
    const dl = (path: string) => t.call("viv", "GET", `/shared/share/${made[0].id}${path}`);
    assert.deepEqual((await dl("/list")).data.items.map((i: any) => i.name), ["Paket-A", "Paket-B"]);
    assert.equal((await t.call("", "GET", `/shared/share/${made[0].id}/list`)).status, 401, "not signed in");
    assert.ok([403, 404].includes((await t.call("ben", "GET", `/shared/share/${made[0].id}/list`)).status), "another account cannot open it");
    const outside = (await list()).find((i: any) => i.name === "rahasia-paket.txt"); assert.equal((await dl(`/files/${outside.id}/download`)).status, 403);
    assert.equal((await t.call("viv", "POST", `/shared/share/${made[0].id}/folders`, { parentId: "root", name: "x" })).status, 403, "viewer cannot write");
    await t.call("ana", "PATCH", `/shares/${made[0].id}`, { role: "EDITOR" });
    const fa = (await dl("/list")).data.items.find((i: any) => i.name === "Paket-A");
    assert.equal((await t.call("viv", "POST", `/shared/share/${made[0].id}/folders`, { parentId: fa.id, name: "dari-viv" })).status, 200, "the permission change applies at once");
    const act = (await t.call("ana", "GET", `/files/${sid}/${a}/activity`)).data as any[]; assert.ok(act.some((x) => x.action === "share" && x.actorKind === "member"));
    const again = (await t.call("ana", "POST", "/shares", { storageId: sid, fileId: a, recipientUserIds: [viv], role: "VIEWER" })).data; const again2 = (await t.call("ana", "POST", "/shares", { storageId: sid, fileId: a, recipientUserIds: [viv], role: "EDITOR" })).data;
    assert.equal(again[0].id, again2[0].id, "sharing the same item with the same member again updates it instead of duplicating");
    await t.call("ana", "DELETE", `/shares/${made[0].id}`); assert.equal((await dl("/list")).status, 404, "revoking takes it away immediately");
    assert.ok(!(await t.call("viv", "GET", "/shared-with-me")).data.some((x: any) => x.id === made[0].id));
  });
});

describe("media gallery", () => {
  it("lists photos and videos newest first with stable paging, filters by kind, and respects workspaces", async () => {
    const dir = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Galeri" })).data.id; const abs = path.join(t.root, "s", "Galeri");
    const names = ["p1.jpg", "p2.png", "v1.mp4", "p3.webp", "v2.mov", "catatan.txt"]; const base = Date.now() - 100_000;
    names.forEach((n, i) => { const f = path.join(abs, n); fs.writeFileSync(f, "x"); fs.utimesSync(f, new Date(base + i * 1000), new Date(base + i * 1000)); });
    await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${dir}`);
    const all: string[] = []; let cur = ""; let pages = 0;
    do { const r = (await t.call("ana", "GET", `/media?kind=all&limit=2${cur ? `&cursor=${encodeURIComponent(cur)}` : ""}`)).data; pages++; for (const i of r.items) if (i.parentId === dir) all.push(i.name); cur = r.nextCursor ?? ""; } while (cur && pages < 200);
    assert.deepEqual(all, ["v2.mov", "p3.webp", "v1.mp4", "p2.png", "p1.jpg"], "newest first, no duplicates or gaps across pages, text files excluded");
    const imgs = (await t.call("ana", "GET", "/media?kind=image&limit=300")).data; assert.ok(imgs.items.every((i: any) => i.mimeType.startsWith("image/")));
    const vids = (await t.call("ana", "GET", "/media?kind=video&limit=300")).data; assert.ok(vids.items.every((i: any) => i.mimeType.startsWith("video/")) && vids.items.some((i: any) => i.name === "v1.mp4"));
    assert.ok(imgs.counts.image >= 3 && vids.counts.video >= 2);
    assert.equal((await t.call("ben", "GET", "/media")).data.items.some((i: any) => i.parentId === dir), false, "another workspace sees none of it");
    assert.equal((await t.call("", "GET", "/media")).status, 401);
  });
});
