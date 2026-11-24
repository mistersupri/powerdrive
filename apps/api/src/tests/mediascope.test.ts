import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>; let s1 = "", s2 = "";
async function up(storage: string, name: string, parent = "root") {
  const buf = Buffer.from("x" + name);
  const c = await t.call("ana", "POST", "/uploads", { storageId: storage, parentId: parent, name, size: buf.length });
  return (await t.call("ana", "PATCH", `/uploads/${c.data.id}`, buf, { "upload-offset": "0", "content-type": "application/octet-stream" })).data.file;
}

before(async () => {
  t = await bootstrap(); await t.register("ana");
  s1 = (await t.call("ana", "POST", "/storages", { provider: "LOCAL", name: "Satu", root: "m1" })).data.id;
  s2 = (await t.call("ana", "POST", "/storages", { provider: "LOCAL", name: "Dua", root: "m2" })).data.id;
  const d1 = await t.call("ana", "POST", "/files/folders", { storageId: s1, parentId: "root", name: "Liburan" });
  const d2 = await t.call("ana", "POST", "/files/folders", { storageId: s2, parentId: "root", name: "Kantor" });
  await up(s1, "a.jpg", d1.data.id); await up(s2, "b.jpg", d2.data.id); await up(s2, "c.mp4", d2.data.id);
});
after(async () => { await t.engine.stop(); await t.app.close(); });

describe("media is kept apart per storage", () => {
  it("lists, counts, groups by folder and builds the timeline for one storage only", async () => {
    const one = (await t.call("ana", "GET", `/media?storageId=${s1}`)).data; const two = (await t.call("ana", "GET", `/media?storageId=${s2}`)).data;
    assert.deepEqual(one.items.map((i: any) => i.name), ["a.jpg"]); assert.deepEqual(one.counts, { image: 1, video: 0 });
    assert.deepEqual(two.items.map((i: any) => i.name).sort(), ["b.jpg", "c.mp4"]); assert.deepEqual(two.counts, { image: 1, video: 1 });
    assert.deepEqual((await t.call("ana", "GET", `/media/folders?storageId=${s1}`)).data.items.map((f: any) => f.name), ["Liburan"]);
    assert.deepEqual((await t.call("ana", "GET", `/media/folders?storageId=${s2}`)).data.items.map((f: any) => f.name), ["Kantor"]);
    assert.equal((await t.call("ana", "GET", `/media/timeline?storageId=${s1}`)).data.months.reduce((n: number, m: any) => n + m.count, 0), 1);
    const all = (await t.call("ana", "GET", "/media")).data; assert.equal(all.items.length, 3, "without a storage, all of them together");
  });
  it("accepts a storage for the on-this-day highlights too", async () => {
    const r = await t.call("ana", "GET", `/media/highlights?date=2026-11-24&tz=0&storageId=${s1}`);
    assert.equal(r.status, 200); assert.ok(Array.isArray(r.data.groups));
  });
});
