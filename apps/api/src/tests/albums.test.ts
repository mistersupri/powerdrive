import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>; let sid = "";
before(async () => {
  t = await bootstrap(); await t.register("ana"); await t.register("ben");
  sid = (await t.call("ana", "POST", "/storages", { provider: "LOCAL", name: "S", root: "s" })).data.id;
  await t.wait(async () => (await t.call("ana", "GET", "/storages")).data.some((s: any) => s.isDefault));
});
after(async () => { await t.engine.stop(); await t.app.close(); });

/** Puts photos in folders and lets the app list them so the index knows them. */
let seeded: Awaited<ReturnType<typeof build>> | null = null;
const seed = async () => (seeded ??= await build());
async function build() {
  const out: Record<string, any> = {};
  for (const dir of ["Camera", "Screenshots"]) {
    const id = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: dir })).data.id; const abs = path.join(t.root, "s", dir); out[dir] = id;
    for (const n of dir === "Camera" ? ["a.jpg", "b.jpg", "c.png"] : ["s1.png", "v1.mp4"]) { fs.writeFileSync(path.join(abs, n), "x"); }
    await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${id}`);
  }
  const all = (await t.call("ana", "GET", "/media?limit=300")).data.items as any[];
  const by = (n: string) => all.find((i) => i.name === n);
  return { dirs: out, by, all };
}
const names = async (q: string) => ((await t.call("ana", "GET", `/media?limit=300${q}`)).data.items as any[]).map((i) => i.name).sort();
const ref = (e: any) => ({ storageId: e.storageId, fileId: e.id });

describe("albums", () => {
  it("groups photos by folder", async () => {
    const { dirs } = await seed();
    const folders = (await t.call("ana", "GET", "/media/folders")).data.items as any[];
    const camera = folders.find((f) => f.name === "Camera"); const shots = folders.find((f) => f.name === "Screenshots");
    assert.equal(camera.count, 3); assert.equal(shots.count, 2); assert.ok(camera.cover?.name);
    assert.deepEqual(await names(`&storageId=${sid}&folderId=${camera.folderId}`), ["a.jpg", "b.jpg", "c.png"]);
    assert.equal(camera.folderId, dirs.Camera);
    assert.equal(((await t.call("ben", "GET", "/media/folders")).data.items as any[]).some((f) => f.name === "Camera"), false, "another workspace sees nothing");
  });

  it("creates albums, adds and removes photos, renames and deletes", async () => {
    const { by } = await seed();
    const a = (await t.call("ana", "POST", "/albums", { name: "Liburan" })); assert.equal(a.status, 201);
    const id = a.data.id;
    assert.equal((await t.call("ana", "POST", `/albums/${id}/items`, { items: [ref(by("a.jpg")), ref(by("s1.png"))] })).data.added, 2);
    assert.equal((await t.call("ana", "POST", `/albums/${id}/items`, { items: [ref(by("a.jpg"))] })).data.added, 0, "no duplicates");
    assert.deepEqual(await names(`&albumId=${id}`), ["a.jpg", "s1.png"]);
    const list = (await t.call("ana", "GET", "/albums")).data.albums as any[]; const row = list.find((x) => x.id === id);
    assert.equal(row.count, 2); assert.ok(row.cover);
    await t.call("ana", "POST", `/albums/${id}/items/remove`, { items: [ref(by("s1.png"))] });
    assert.deepEqual(await names(`&albumId=${id}`), ["a.jpg"]);
    assert.equal((await t.call("ana", "PATCH", `/albums/${id}`, { name: "Pantai" })).data.name, "Pantai");
    assert.equal((await t.call("ben", "GET", `/media?albumId=${id}`)).status, 404, "albums are personal");
    assert.equal((await t.call("ana", "DELETE", `/albums/${id}`)).status, 200);
    assert.equal(((await t.call("ana", "GET", "/albums")).data.albums as any[]).some((x) => x.id === id), false);
    assert.equal((await t.call("ana", "POST", "/albums", { name: "   " })).status, 400);
  });
});

describe("private albums", () => {
  it("need a password, hide their photos everywhere, and open only after unlocking", async () => {
    const { by, dirs } = await seed();
    assert.equal((await t.call("ana", "POST", "/albums", { name: "Rahasia", private: true })).body.error.code, "NO_PASSWORD");
    assert.equal((await t.call("ana", "POST", "/albums-private/password", { password: "12" })).status, 400, "at least 6 characters");
    assert.equal((await t.call("ana", "POST", "/albums-private/password", { password: "rahasia-4821" })).status, 200);
    assert.equal((await t.call("ana", "POST", "/albums", { name: "Rahasia", private: true })).body.error.code, "PRIVATE_LOCKED", "a password alone is not an unlock");
    assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { password: "salah-sekali" })).body.error.code, "WRONG_PASSWORD");
    assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { password: "rahasia-4821" })).data.unlocked, true);
    const al = (await t.call("ana", "POST", "/albums", { name: "Rahasia", private: true })).data; assert.equal(al.isPrivate, true);
    await t.call("ana", "POST", `/albums/${al.id}/items`, { items: [ref(by("b.jpg"))] });
    // unlocked: it is in its album, but still not in the general views
    assert.deepEqual(await names(`&albumId=${al.id}`), ["b.jpg"]);
    assert.ok(!(await names("")).includes("b.jpg"), "gone from the gallery");
    assert.ok(!(await names(`&storageId=${sid}&folderId=${dirs.Camera}`)).includes("b.jpg"), "gone from the folder view");
    assert.ok(!((await t.call("ana", "GET", `/search?q=b.jpg`)).data.items as any[]).some((i) => i.name === "b.jpg"), "gone from search");
    assert.ok(!((await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${dirs.Camera}`)).data.items as any[]).some((i) => i.name === "b.jpg"), "gone from the file listing");
    assert.equal(((await t.call("ana", "GET", "/media/folders")).data.items as any[]).find((f) => f.name === "Camera").count, 2);
    // locking hides the album itself again
    await t.call("ana", "POST", "/albums-private/lock");
    assert.equal(((await t.call("ana", "GET", "/albums")).data.albums as any[]).some((x) => x.id === al.id), false);
    assert.equal((await t.call("ana", "GET", `/media?albumId=${al.id}`)).body.error.code, "PRIVATE_LOCKED");
    assert.equal((await t.call("ana", "GET", "/albums-private/status")).data.count, 1, "the lock screen can still say there is something");
    await t.call("ana", "POST", "/albums-private/unlock", { password: "rahasia-4821" });
    await t.call("ana", "POST", `/albums/${al.id}/items/remove`, { items: [ref(by("b.jpg"))] });
    assert.ok((await names("")).includes("b.jpg"), "taking it out of the album brings it back");
  });

  it("locks out after five wrong passwords", async () => {
    for (let i = 0; i < 4; i++) assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { password: "salah-lagi" })).body.error.code, "WRONG_PASSWORD");
    assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { password: "salah-lagi" })).body.error.code, "PASSWORD_LOCKED");
    assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { password: "rahasia-4821" })).body.error.code, "PASSWORD_LOCKED", "even the right password waits");
  });

  it("changing the password needs the current one", async () => {
    await t.register("cy"); assert.equal((await t.call("cy", "POST", "/albums-private/password", { password: "pertama-1111" })).status, 200);
    assert.equal((await t.call("cy", "POST", "/albums-private/password", { password: "kedua-2222" })).status, 401, "no current password given");
    assert.equal((await t.call("cy", "POST", "/albums-private/password", { password: "kedua-2222", currentPassword: "pertama-1111" })).status, 200);
    assert.equal((await t.call("cy", "POST", "/albums-private/unlock", { password: "kedua-2222" })).data.unlocked, true);
  });
});

describe("highlights (on this day)", () => {
  it("shows earlier years' photos from today and the next three days, in the caller's own time zone", async () => {
    const dir = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Kenangan" })).data.id; const abs = path.join(t.root, "s", "Kenangan");
    // today is 2026-11-14; the window is 11-14 .. 11-17
    const at: Record<string, string> = {
      "in-0.jpg": "2023-11-14T10:00:00Z", "in-2.jpg": "2023-11-16T10:00:00Z", "in-3.jpg": "2024-11-17T12:00:00Z", "in-video.mp4": "2022-11-15T09:00:00Z",
      "out-4.jpg": "2023-11-18T10:00:00Z", "out-before.jpg": "2025-11-13T10:00:00Z", "out-thisyear.jpg": "2026-11-14T08:00:00Z", "tz.jpg": "2023-11-13T20:00:00Z", "note.txt": "2023-11-14T10:00:00Z",
    };
    for (const [n, iso] of Object.entries(at)) { const f = path.join(abs, n); fs.writeFileSync(f, "x"); fs.utimesSync(f, new Date(iso), new Date(iso)); }
    await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${dir}`);
    const names = (g: any) => g.items.map((i: any) => i.name).sort();
    const utc = (await t.call("ana", "GET", "/media/highlights?date=2026-11-14&tz=0")).data;
    assert.equal(utc.from, "2026-11-14"); assert.equal(utc.until, "2026-11-17");
    const by = Object.fromEntries(utc.groups.map((g: any) => [g.yearsAgo, g]));
    assert.deepEqual(names(by[3]), ["in-0.jpg", "in-2.jpg"], "2023: the 14th and 16th, not the 18th, and the 13th 20:00Z is still the 13th in UTC");
    assert.deepEqual(names(by[2]), ["in-3.jpg"]); assert.deepEqual(names(by[4]), ["in-video.mp4"]);
    assert.ok(!utc.groups.some((g: any) => g.yearsAgo === 0 || g.yearsAgo < 1), "this year's photos are not memories");
    assert.deepEqual(utc.groups.map((g: any) => g.yearsAgo), [2, 3, 4], "nearest year first");
    // Jakarta (UTC+7): 20:00Z on the 13th is 03:00 on the 14th there
    const jkt = (await t.call("ana", "GET", "/media/highlights?date=2026-11-14&tz=420")).data;
    assert.deepEqual(names(jkt.groups.find((g: any) => g.yearsAgo === 3)), ["in-0.jpg", "in-2.jpg", "tz.jpg"]);
    // a window that crosses the year end
    const nye = (await t.call("ana", "GET", "/media/highlights?date=2026-11-30&tz=0")).data; assert.equal(nye.until, "2026-12-03");
    assert.equal((await t.call("ana", "GET", "/media/highlights?date=nonsense")).status, 400);
    assert.equal((await t.call("ben", "GET", "/media/highlights?date=2026-11-14")).data.groups.length, 0, "another workspace sees nothing");
    // photos in a private album are never memories
    await t.call("ana", "POST", "/albums-private/password", { password: "kenangan-rahasia" }); await t.call("ana", "POST", "/albums-private/unlock", { password: "kenangan-rahasia" });
    const al = (await t.call("ana", "POST", "/albums", { name: "Pribadi", private: true })).data;
    const inZero = ((await t.call("ana", "GET", "/media?limit=300")).data.items as any[]).find((i) => i.name === "in-0.jpg");
    await t.call("ana", "POST", `/albums/${al.id}/items`, { items: [{ storageId: inZero.storageId, fileId: inZero.id }] });
    assert.deepEqual(names((await t.call("ana", "GET", "/media/highlights?date=2026-11-14&tz=0")).data.groups.find((g: any) => g.yearsAgo === 3)), ["in-2.jpg"]);
  });
});

describe("upload dates", () => {
  it("keep the date a photo was taken, when the sender says so", async () => {
    const taken = Date.UTC(2021, 5, 15, 12, 0, 0);
    const c = await t.call("ana", "POST", "/uploads", { storageId: sid, parentId: "root", name: "liburan.jpg", size: 3, lastModified: taken });
    await t.call("ana", "PATCH", `/uploads/${c.data.id}`, Buffer.from("abc"), { "upload-offset": "0", "content-type": "application/octet-stream" });
    await t.wait(async () => (await t.call("ana", "GET", `/uploads/${c.data.id}`)).data.status === "DONE");
    const f = ((await t.call("ana", "GET", `/files?storageId=${sid}&folderId=root`)).data.items as any[]).find((i) => i.name === "liburan.jpg");
    assert.equal(new Date(f.modifiedAt).getTime(), taken);
    const d = await t.call("ana", "POST", "/uploads", { storageId: sid, parentId: "root", name: "masa-depan.jpg", size: 1, lastModified: Date.now() + 10 * 86_400_000 });
    await t.call("ana", "PATCH", `/uploads/${d.data.id}`, Buffer.from("a"), { "upload-offset": "0", "content-type": "application/octet-stream" });
    await t.wait(async () => (await t.call("ana", "GET", `/uploads/${d.data.id}`)).data.status === "DONE");
    const g = ((await t.call("ana", "GET", `/files?storageId=${sid}&folderId=root`)).data.items as any[]).find((i) => i.name === "masa-depan.jpg");
    assert.ok(new Date(g.modifiedAt).getTime() < Date.now() + 60_000, "an implausible date is ignored");
  });
});

describe("gallery filters and places", () => {
  it("counts photos per month and narrows by date", async () => {
    await seed();
    const tl = (await t.call("ana", "GET", "/media/timeline")).data.months as any[];
    assert.ok(tl.length >= 1);
    const all = (await names("")).length;
    assert.equal(tl.reduce((n, m) => n + m.count, 0), all);
    assert.equal(((await t.call("ana", "GET", "/media/timeline?kind=video")).data.months as any[]).reduce((n, m) => n + m.count, 0), (await names("&kind=video")).length);
    assert.equal((await names("&before=2000-01-01")).length, 0, "nothing was taken before 2000");
    assert.equal((await names("&after=2000-01-01")).length, all);
    assert.equal(((await t.call("ana", "GET", "/media/timeline?before=2000-01-01")).data.months as any[]).length, 0);
  });
  it("tells where a shared item and an upload live", async () => {
    const { dirs, by } = await seed();
    const photo = by("a.jpg");
    await t.call("ana", "POST", "/shares", { storageId: sid, fileId: photo.id, role: "VIEWER" });
    const shares = (await t.call("ana", "GET", "/shares/all")).data.items as any[];
    const mine = shares.find((s) => s.name === "a.jpg");
    assert.equal(mine.place.path, "/Camera"); assert.equal(mine.place.folderId, dirs.Camera);
    const hist = (await t.call("ana", "GET", "/uploads/history")).data;
    assert.ok(Array.isArray(hist.items));
  });
});
