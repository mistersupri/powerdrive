import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { parseFolderList } from "@superdrive/shared";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>; let sid = "";
const kids = async (folder = "root") => (await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${folder}`)).data.items;
const names = async (folder = "root") => (await kids(folder)).map((i: any) => i.name).sort();

before(async () => { t = await bootstrap(); await t.register("ana"); await t.register("ben"); sid = (await t.call("ana", "POST", "/storages", { provider: "LOCAL", name: "F", root: "f" })).data.id; });
after(async () => { await t.engine.stop(); await t.app.close(); });

describe("folder list (pure)", () => {
  it("nests by indentation, accepts bullets, tabs and blank lines", () => {
    const r = parseFolderList("Proyek\n  Desain\n  Kode\n    Api\n\n- Arsip\n\tLama\n");
    assert.equal(r.count, 6); assert.deepEqual(r.errors, []);
    assert.deepEqual(r.nodes.map((n) => n.name), ["Proyek", "Arsip"]);
    assert.deepEqual(r.nodes[0]!.children.map((n) => n.name), ["Desain", "Kode"]);
    assert.equal(r.nodes[0]!.children[1]!.children[0]!.name, "Api");
    assert.equal(r.nodes[1]!.children[0]!.name, "Lama");
  });
  it("reports bad names and too many folders", () => {
    assert.match(parseFolderList("a/b").errors[0]!, /Baris 1/);
    assert.ok(parseFolderList(Array.from({ length: 201 }, (_, i) => `f${i}`).join("\n")).errors.length > 0);
  });
});

describe("POST /files/folders/batch", () => {
  it("creates the tree, reuses existing folders and reports files in the way", async () => {
    const r = await t.call("ana", "POST", "/files/folders/batch", { storageId: sid, parentId: "root", text: "Proyek\n  Desain\n  Kode\nArsip" });
    assert.deepEqual([r.data.created, r.data.existing], [4, 0]);
    assert.deepEqual(await names(), ["Arsip", "Proyek"]);
    const proyek = (await kids()).find((i: any) => i.name === "Proyek");
    assert.deepEqual(await names(proyek.id), ["Desain", "Kode"]);
    const again = await t.call("ana", "POST", "/files/folders/batch", { storageId: sid, parentId: "root", text: "Proyek\n  Desain\n  Tes\nBaru" });
    assert.deepEqual([again.data.created, again.data.existing], [2, 2]);
    assert.deepEqual(await names(proyek.id), ["Desain", "Kode", "Tes"]);
    const buf = Buffer.from("x"); const up = await t.call("ana", "POST", "/uploads", { storageId: sid, parentId: "root", name: "catatan", size: 1 });
    await t.call("ana", "PATCH", `/uploads/${up.data.id}`, buf, { "upload-offset": "0", "content-type": "application/octet-stream" });
    const clash = await t.call("ana", "POST", "/files/folders/batch", { storageId: sid, parentId: "root", text: "catatan\n  anak\nlain" });
    assert.equal(clash.data.created, 1); assert.match(clash.data.skipped[0], /catatan/);
  });
  it("rejects an invalid or empty list without creating anything, and other workspaces", async () => {
    assert.equal((await t.call("ana", "POST", "/files/folders/batch", { storageId: sid, parentId: "root", text: "bagus\nburuk/nama" })).status, 400);
    assert.ok(!(await names()).includes("bagus"));
    assert.equal((await t.call("ana", "POST", "/files/folders/batch", { storageId: sid, parentId: "root", text: "  \n" })).status, 400);
    assert.equal((await t.call("ben", "POST", "/files/folders/batch", { storageId: sid, parentId: "root", text: "x" })).status, 404);
  });
});
