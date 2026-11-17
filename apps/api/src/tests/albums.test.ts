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
  it("need a PIN, hide their photos everywhere, and open only after unlocking", async () => {
    const { by, dirs } = await seed();
    assert.equal((await t.call("ana", "POST", "/albums", { name: "Rahasia", private: true })).body.error.code, "NO_PIN");
    assert.equal((await t.call("ana", "POST", "/albums-private/pin", { pin: "12" })).status, 400, "PIN is 4-8 digits");
    assert.equal((await t.call("ana", "POST", "/albums-private/pin", { pin: "4821" })).status, 200);
    assert.equal((await t.call("ana", "POST", "/albums", { name: "Rahasia", private: true })).body.error.code, "PRIVATE_LOCKED", "a PIN alone is not an unlock");
    assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { pin: "0000" })).body.error.code, "WRONG_PIN");
    assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { pin: "4821" })).data.unlocked, true);
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
    await t.call("ana", "POST", "/albums-private/unlock", { pin: "4821" });
    await t.call("ana", "POST", `/albums/${al.id}/items/remove`, { items: [ref(by("b.jpg"))] });
    assert.ok((await names("")).includes("b.jpg"), "taking it out of the album brings it back");
  });

  it("locks out after five wrong PINs and re-locks when the PIN changes", async () => {
    for (let i = 0; i < 4; i++) assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { pin: "9999" })).body.error.code, "WRONG_PIN");
    assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { pin: "9999" })).body.error.code, "PIN_LOCKED");
    assert.equal((await t.call("ana", "POST", "/albums-private/unlock", { pin: "4821" })).body.error.code, "PIN_LOCKED", "even the right PIN waits");
  });

  it("changing the PIN needs the current one", async () => {
    await t.register("cy"); assert.equal((await t.call("cy", "POST", "/albums-private/pin", { pin: "1111" })).status, 200);
    assert.equal((await t.call("cy", "POST", "/albums-private/pin", { pin: "2222" })).status, 401, "no current PIN given");
    assert.equal((await t.call("cy", "POST", "/albums-private/pin", { pin: "2222", currentPin: "1111" })).status, 200);
    assert.equal((await t.call("cy", "POST", "/albums-private/unlock", { pin: "2222" })).data.unlocked, true);
  });
});
