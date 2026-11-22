import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { applyRenameRule } from "@superdrive/shared";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>; let sid = "";
async function mk(name: string, body = "x", parent = "root") {
  const buf = Buffer.from(body);
  const c = await t.call("ana", "POST", "/uploads", { storageId: sid, parentId: parent, name, size: buf.length });
  return (await t.call("ana", "PATCH", `/uploads/${c.data.id}`, buf, { "upload-offset": "0", "content-type": "application/octet-stream" })).data.file;
}
const names = async (folder = "root") => (await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${folder}`)).data.items.map((i: any) => i.name).sort();

before(async () => {
  t = await bootstrap(); await t.register("ana"); await t.register("ben");
  sid = (await t.call("ana", "POST", "/storages", { provider: "LOCAL", name: "R", root: "r" })).data.id;
});
after(async () => { await t.engine.stop(); await t.app.close(); });

describe("rename rules (pure)", () => {
  const f = (name: string, isFolder = false) => ({ name, isFolder });
  it("keeps extensions and treats folders as having none", () => {
    assert.deepEqual(applyRenameRule([f("IMG_01.JPG"), f("v1.2", true)], { find: "IMG_", replace: "Foto ", extension: "lower" }), ["Foto 01.jpg", "v1.2"]);
  });
  it("numbers in order with padding, prefix and suffix", () => {
    assert.deepEqual(applyRenameRule([f("a.png"), f("b.png"), f("c.png")], { numbering: { start: 1, step: 1, pad: 3, where: "replace" }, prefix: "Liburan " }), ["Liburan 001.png", "Liburan 002.png", "Liburan 003.png"]);
    assert.deepEqual(applyRenameRule([f("a.png"), f("b.png")], { numbering: { start: 5, step: 5, pad: 0, where: "suffix", sep: "_" } }), ["a_5.png", "b_10.png"]);
  });
  it("changes case, supports regex and rejects a bad pattern", () => {
    assert.deepEqual(applyRenameRule([f("hello_big world.TXT")], { casing: "title" }), ["Hello_Big World.TXT"]);
    assert.deepEqual(applyRenameRule([f("report-2024-03.pdf")], { find: "(\\d{4})-(\\d{2})", replace: "$2.$1", regex: true }), ["report-03.2024.pdf"]);
    assert.throws(() => applyRenameRule([f("a")], { find: "(", regex: true }), /tidak valid/);
  });
});

describe("bulk rename and duplicate", () => {
  it("previews without changing, then renames and reports clashes", async () => {
    const a = await mk("a.txt"); const b = await mk("b.txt"); await mk("taken.txt");
    const rule = { numbering: { start: 1, step: 1, pad: 0, where: "replace" as const }, prefix: "doc" };
    const dry = await t.call("ana", "POST", "/files/rename-batch", { storageId: sid, fileIds: [a.id, b.id], rule, dryRun: true });
    assert.deepEqual(dry.data.items.map((i: any) => [i.from, i.to, i.status]), [["a.txt", "doc1.txt", "ok"], ["b.txt", "doc2.txt", "ok"]]);
    assert.ok((await names()).includes("a.txt"), "preview changed nothing");
    const clash = await t.call("ana", "POST", "/files/rename-batch", { storageId: sid, fileIds: [a.id], rule: { find: "a", replace: "taken" } });
    assert.equal(clash.data.renamed, 0); assert.equal(clash.data.items[0].status, "error");
    const done = await t.call("ana", "POST", "/files/rename-batch", { storageId: sid, fileIds: [a.id, b.id], rule });
    assert.equal(done.data.renamed, 2);
    assert.ok((await names()).includes("doc1.txt") && (await names()).includes("doc2.txt"));
  });
  it("refuses two items ending up with the same name, and a swap", async () => {
    const x = await mk("x1.log"); const y = await mk("x2.log");
    const same = await t.call("ana", "POST", "/files/rename-batch", { storageId: sid, fileIds: [x.id, y.id], rule: { find: "x\\d", replace: "same", regex: true } });
    assert.equal(same.data.renamed, 0); assert.ok(same.data.items.every((i: any) => i.status === "error"));
    const chain = await t.call("ana", "POST", "/files/rename-batch", { storageId: sid, fileIds: [x.id, y.id], rule: { find: "x1", replace: "x2" }, dryRun: true });
    assert.equal(chain.data.items[0].status, "error", "x1 → x2 would clash with the old name of the other item");
  });
  it("is limited to those allowed to rename", async () => {
    const f = await mk("only-ana.txt");
    assert.equal((await t.call("ben", "POST", "/files/rename-batch", { storageId: sid, fileIds: [f.id], rule: { prefix: "z" } })).status, 404);
  });
  it("duplicates files and folders next to the original", async () => {
    const dir = await t.call("ana", "POST", "/files/folders", { storageId: sid, parentId: "root", name: "Album" });
    await mk("inner.txt", "hello", dir.data.id); const pic = await mk("pic.jpg", "jpgdata");
    const r = await t.call("ana", "POST", "/files/duplicate", { storageId: sid, fileIds: [dir.data.id, pic.id] });
    assert.equal(r.status, 202);
    await t.wait(async () => ((await t.call("ana", "GET", "/transfers")).data.items as any[]).every((j) => !["QUEUED", "RUNNING", "VALIDATING"].includes(j.status)));
    const top = await names(); assert.ok(top.includes("pic (2).jpg") && top.includes("Album (2)") && top.includes("Album") && top.includes("pic.jpg"), top.join(","));
    const copy = (await t.call("ana", "GET", `/files?storageId=${sid}&folderId=root`)).data.items.find((i: any) => i.name === "Album (2)");
    assert.deepEqual(await names(copy.id), ["inner.txt"]);
  });
});
