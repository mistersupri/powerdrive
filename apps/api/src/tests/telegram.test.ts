import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { bootstrap } from "./helpers.ts";
import { FakeTelegram } from "./telegramFake.ts";

let t: Awaited<ReturnType<typeof bootstrap>>; let n = 0;
before(async () => { t = await bootstrap(); });
after(async () => { await t.engine.stop(); await t.app.close(); });

async function make(partSize = 1_000_000, fake = new FakeTelegram(partSize)) {
  const { TelegramProvider } = await import("../providers/telegram.ts");
  const id = `tg-${++n}`; return { fake, id, p: new TelegramProvider(fake, id, "TG", { partSize, syncEveryMs: 0 }), mk: () => new TelegramProvider(fake, id, "TG", { partSize, syncEveryMs: 0 }) };
}
const bytes = async (s: Readable) => { const c: Buffer[] = []; for await (const d of s) c.push(d as Buffer); return Buffer.concat(c); };
const put = (p: any, parentId: string, name: string, data: Buffer, mimeType?: string) => p.write({ parentId, name, size: data.length, mimeType, stream: Readable.from([data]) });

describe("telegram storage", () => {
  it("cuts big files into pieces, reads them back whole and by range across the cuts, and removes every piece", async () => {
    const { p, fake } = await make(1_000_000); const data = crypto.randomBytes(2_500_000);
    const f = await put(p, "root", "besar.bin", data, "application/octet-stream");
    assert.equal(f.size, 2_500_000); assert.equal(fake.sent, 3, "three messages carry one file");
    assert.deepEqual(await bytes((await p.read(f.id)).stream), data);
    const across = await bytes((await p.read(f.id, { range: { start: 999_990, end: 2_000_009 } })).stream);
    assert.deepEqual(across, data.subarray(999_990, 2_000_010), "a range spanning two cuts");
    assert.equal((await p.read(f.id, { range: { start: 2_499_999 } })).size, 1);
    const before = fake.msgs.size; await p.delete(f.id); assert.equal(before - fake.msgs.size, 3);
    assert.equal((await p.list("root")).items.length, 0);
  });

  it("keeps empty files (Telegram cannot send an empty document)", async () => {
    const { p } = await make(); const f = await put(p, "root", "kosong.txt", Buffer.alloc(0), "text/plain");
    assert.equal(f.size, 0); const r = await p.read(f.id); assert.equal(r.size, 0); assert.equal((await bytes(r.stream)).length, 0);
  });

  it("rebuilds the whole tree from the channel when its local copy is gone", async () => {
    const { p, fake, id, mk } = await make();
    const a = await p.createFolder("root", "Laporan"); const b = await p.createFolder(a.id, "2026");
    await put(p, b.id, "ringkasan.txt", Buffer.from("isi"), "text/plain");
    const moved = await put(p, "root", "lepas.txt", Buffer.from("x")); await p.move(moved.id, a.id, "dipindah.txt");
    const { db } = await import("../db.ts"); db.run("DELETE FROM telegram_items WHERE storage_id = ?", id); db.run("DELETE FROM telegram_sync WHERE storage_id = ?", id);
    const fresh = mk();
    assert.deepEqual((await fresh.list("root")).items.map((i) => i.name), ["Laporan"]);
    assert.deepEqual((await fresh.list(a.id)).items.map((i) => i.name), ["2026", "dipindah.txt"], "folders first, then files");
    assert.deepEqual((await fresh.path(b.id)).map((c) => c.name), ["Laporan", "2026"]);
    const f = (await fresh.list(b.id)).items[0]!; assert.equal(Buffer.from(await bytes((await fresh.read(f.id)).stream)).toString(), "isi");
    assert.ok(fake.msgs.size >= 4);
  });

  it("notices what was deleted or edited in Telegram itself on the next full read", async () => {
    const { p, fake, id } = await make(); const keep = await put(p, "root", "tetap.txt", Buffer.from("a")); const gone = await put(p, "root", "hilang.txt", Buffer.from("b"));
    fake.msgs.delete(Number(gone.id));
    assert.equal((await p.list("root")).items.length, 2, "an incremental read does not know about deletions");
    const { db } = await import("../db.ts"); db.run("UPDATE telegram_sync SET full_at = '2000-01-01T00:00:00Z' WHERE storage_id = ?", id);
    const names = (await p.list("root")).items.map((i) => i.name); assert.deepEqual(names, ["tetap.txt"]); assert.ok(keep);
  });

  it("renames and moves with a caption edit only, and refuses clashes and loops", async () => {
    const { p, fake } = await make(); const d1 = await p.createFolder("root", "A"); const d2 = await p.createFolder(d1.id, "B");
    const f = await put(p, "root", "satu.txt", Buffer.from("1")); await put(p, "root", "dua.txt", Buffer.from("2"));
    const uploads = fake.sent;
    const r = await p.rename(f.id, "tiga.txt"); assert.equal(r.name, "tiga.txt");
    await assert.rejects(() => p.rename(f.id, "dua.txt"), (e: any) => e.kind === "conflict");
    await assert.rejects(() => p.move(d1.id, d2.id), /dirinya sendiri/);
    const m = await p.move(f.id, d2.id); assert.equal(m.parentId, d2.id); assert.equal(fake.sent, uploads, "nothing was uploaded again");
    assert.deepEqual((await p.path(m.id)).map((c) => c.name), ["A", "B", "tiga.txt"]);
    assert.equal(await p.findChild("root", "tiga.txt"), null);
  });

  it("deletes a folder with everything inside it", async () => {
    const { p, fake } = await make(); const d = await p.createFolder("root", "Hapus"); const e = await p.createFolder(d.id, "Dalam");
    await put(p, d.id, "a.txt", Buffer.from("a")); await put(p, e.id, "b.txt", Buffer.from("b")); await put(p, "root", "luar.txt", Buffer.from("c"));
    await p.delete(d.id);
    assert.deepEqual((await p.list("root")).items.map((i) => i.name), ["luar.txt"]); assert.equal([...fake.msgs.values()].filter((m) => m.data).length, 1);
  });

  it("gives a thumbnail for pictures and none for other files, and rejects names that are too long", async () => {
    const { p } = await make(); const img = await put(p, "root", "foto.jpg", Buffer.from("jpg"), "image/jpeg"); const txt = await put(p, "root", "a.txt", Buffer.from("t"), "text/plain");
    assert.equal(img.hasThumbnail, true); assert.equal(txt.hasThumbnail, false);
    assert.equal((await bytes((await p.thumbnail!(img, 256))!.stream)).toString(), "fake-jpeg"); assert.equal(await p.thumbnail!(txt, 256), null);
    await assert.rejects(() => put(p, "root", "x".repeat(300) + ".txt", Buffer.from("a")), /tidak valid/);
  });

  it("does not leave a half-written file behind when sending fails", async () => {
    const { p, fake } = await make(1_000_000, new FakeTelegram(1_500_000));
    const data = crypto.randomBytes(2_600_000);
    // pieces are 1 MB, so the fake's limit of 1.5 MB is fine for them: break the third one instead
    const original = fake.sendFile.bind(fake); let calls = 0; fake.sendFile = async (...a) => { if (++calls === 3) throw new Error("jaringan putus"); return original(...a); };
    await assert.rejects(() => put(p, "root", "putus.bin", data), /jaringan putus/);
    assert.equal(fake.msgs.size, 0, "the pieces already sent were removed"); assert.equal((await p.list("root")).items.length, 0);
  });
});

describe("telegram storage through the API", () => {
  let sid = ""; let fake: FakeTelegram; const orig: Record<string, unknown> = {};
  before(async () => {
    await t.register("tgadmin");
    const { telegramLogin, telegramApis } = await import("../providers/telegramClient.ts");
    fake = new FakeTelegram(); Object.assign(orig, { ...telegramLogin, for: telegramApis.for });
    let user = { id: "42", name: "Uji Telegram" };
    Object.assign(telegramLogin, {
      start: async (id: string) => ({ loginId: id, state: "code" }),
      code: async (id: string, code: string) => (code === "12345" ? { loginId: id, state: "ready" } : { loginId: id, state: "code", error: "Kode salah." }),
      result: () => ({ credential: { apiId: 1, apiHash: "a".repeat(32), session: "s" }, user }),
      channel: async () => ({ channelId: "777", accessHash: "888" }), forget: () => {},
    });
    (telegramApis as any).for = () => fake; (globalThis as any).__tgUser = (u: typeof user) => { user = u; };
  });
  after(async () => { const { telegramLogin, telegramApis } = await import("../providers/telegramClient.ts"); Object.assign(telegramLogin, orig); (telegramApis as any).for = orig.for; });

  it("signs in step by step and creates the storage", async () => {
    const start = await t.call("tgadmin", "POST", "/storages/telegram/login/start", { apiId: 12345, apiHash: "a".repeat(32), phone: "+62 812-3456-7890" });
    assert.equal(start.status, 200, JSON.stringify(start.body)); assert.equal(start.data.state, "code");
    assert.equal((await t.call("tgadmin", "POST", "/storages/telegram/login/start", { apiId: 12345, apiHash: "short", phone: "+628123456789" })).status, 400, "a malformed API hash is refused up front");
    assert.equal((await t.call("tgadmin", "POST", "/storages/telegram/login/start", { apiId: 12345, apiHash: "a".repeat(32), phone: "abc" })).status, 400);
    assert.equal((await t.call("tgadmin", "POST", "/storages/telegram/login/code", { loginId: start.data.loginId, code: "00000" })).data.error, "Kode salah.");
    assert.equal((await t.call("tgadmin", "POST", "/storages/telegram/login/code", { loginId: start.data.loginId, code: "12345" })).data.state, "ready");
    const made = await t.call("tgadmin", "POST", "/storages", { provider: "TELEGRAM", name: "Arsip Telegram", loginId: start.data.loginId });
    assert.equal(made.status, 200, JSON.stringify(made.body)); sid = made.data.id;
    assert.equal(made.data.provider, "TELEGRAM"); assert.equal(made.data.status, "CONNECTED"); assert.equal(made.data.accountEmail, "@uji");
    assert.equal((await t.call("tgadmin", "GET", "/storages/providers")).data.some((p: any) => p.provider === "TELEGRAM" && p.available), true);
  });

  it("works like any other storage: create a folder, upload, list, download, move, delete", async () => {
    const dir = (await t.call("tgadmin", "POST", "/files/folders", { storageId: sid, name: "Foto" })).data;
    const body = crypto.randomBytes(300_000);
    const up = await t.call("tgadmin", "POST", "/uploads", { storageId: sid, parentId: dir.id, name: "kenangan.jpg", size: body.length, mimeType: "image/jpeg" });
    const done = await t.call("tgadmin", "PATCH", `/uploads/${up.data.id}`, body, { "upload-offset": "0", "content-type": "application/octet-stream" });
    assert.equal(done.data.status, "DONE", JSON.stringify(done.body)); const file = done.data.file;
    const listed = (await t.call("tgadmin", "GET", `/files?storageId=${sid}&folderId=${dir.id}`)).data.items; assert.deepEqual(listed.map((i: any) => i.name), ["kenangan.jpg"]);
    const dl = await t.call("tgadmin", "GET", `/files/${sid}/${file.id}/download`); assert.deepEqual(dl.res.rawPayload, body);
    const part = await t.call("tgadmin", "GET", `/files/${sid}/${file.id}/download`, undefined, { range: "bytes=100-199" }); assert.equal(part.status, 206); assert.deepEqual(part.res.rawPayload, body.subarray(100, 200));
    assert.equal((await t.call("tgadmin", "POST", "/files/rename", { storageId: sid, fileId: file.id, name: "liburan.jpg" })).status, 200);
    assert.equal((await t.call("tgadmin", "DELETE", `/files/${sid}/${file.id}`)).status, 200, "goes to the trash folder first");
    assert.deepEqual((await t.call("tgadmin", "GET", `/files?storageId=${sid}&folderId=${dir.id}`)).data.items, []);
  });

  it("asks for a sign-in again as the same account only", async () => {
    const { telegramLogin } = await import("../providers/telegramClient.ts"); void telegramLogin;
    (globalThis as any).__tgUser({ id: "99", name: "Orang Lain" });
    assert.equal((await t.call("tgadmin", "POST", `/storages/${sid}/telegram/relogin`, { loginId: "x" })).status, 400, "a different account is refused");
    (globalThis as any).__tgUser({ id: "42", name: "Uji Telegram" });
    const ok = await t.call("tgadmin", "POST", `/storages/${sid}/telegram/relogin`, { loginId: "x" }); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.data.status, "CONNECTED");
  });

  it("forgets its copy of the tree when the storage is disconnected", async () => {
    const { db } = await import("../db.ts");
    assert.ok(db.get<{ n: number }>("SELECT COUNT(*) n FROM telegram_items WHERE storage_id = ?", sid)!.n > 0);
    assert.equal((await t.call("tgadmin", "DELETE", `/storages/${sid}`)).status, 200);
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) n FROM telegram_items WHERE storage_id = ?", sid)!.n, 0);
    assert.ok(fake.msgs.size > 0, "disconnecting never deletes anything in Telegram");
  });
});
