import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>; let sid = ""; let ws = "";
const hooks: { body: any; sig: string | undefined; event: string | undefined }[] = [];
let hookServer: http.Server; let hookUrl = "";

before(async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "true";
  t = await bootstrap(); await t.register("ana");
  sid = (await t.call("ana", "POST", "/storages", { provider: "LOCAL", name: "S", root: "s" })).data.id;
  await t.wait(async () => (await t.call("ana", "GET", "/storages")).data.some((s: any) => s.isDefault));
  ws = (await t.call("ana", "GET", "/auth/me")).data.activeWorkspaceId;
  hookServer = http.createServer((req, res) => { const c: Buffer[] = []; req.on("data", (d) => c.push(d)); req.on("end", () => { hooks.push({ body: JSON.parse(Buffer.concat(c).toString() || "{}"), sig: req.headers["x-superdrive-signature"] as string | undefined, event: req.headers["x-superdrive-event"] as string | undefined }); res.end("ok"); }); });
  await new Promise<void>((r) => hookServer.listen(0, "127.0.0.1", () => r())); hookUrl = `http://127.0.0.1:${(hookServer.address() as any).port}/hook`;
});
after(async () => { hookServer.close(); await t.engine.stop(); await t.app.close(); });

const folder = async (name: string, parent = "root") => (await t.call("ana", "POST", "/files/folders", { storageId: sid, parentId: parent, name })).data.id as string;
async function upload(name: string, body: string, parent: string, lastModified?: number) {
  const buf = Buffer.from(body);
  const c = await t.call("ana", "POST", "/uploads", { storageId: sid, parentId: parent, name, size: buf.length, ...(lastModified ? { lastModified } : {}) });
  const r = await t.call("ana", "PATCH", `/uploads/${c.data.id}`, buf, { "upload-offset": "0", "content-type": "application/octet-stream" });
  assert.equal(r.data.status, "DONE", JSON.stringify(r.body)); return r.data.file as { id: string; name: string };
}
const names = async (dir: string) => ((await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${dir}`)).data.items as any[]).map((i) => i.name).sort();
const make = (body: object) => t.call("ana", "POST", "/automations", { enabled: true, recursive: true, conditions: {}, ...body });
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const trashed = async () => ((await t.call("ana", "GET", "/trash")).data.items ?? (await t.call("ana", "GET", "/trash")).data) as any[];

describe("event rules", () => {
  it("tag, star and notify the files that match, and leave the others alone", async () => {
    const inbox = await folder("Masuk");
    const a = await make({ name: "PDF penting", storageId: sid, folderId: inbox, trigger: { type: "file.created" }, conditions: { ext: ["pdf"] }, actions: [{ type: "tag", tag: "penting" }, { type: "star" }, { type: "notify", message: "Masuk: {name}" }] });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const pdf = await upload("kontrak.pdf", "pdf", inbox); const txt = await upload("catatan.txt", "txt", inbox);
    await t.wait(async () => ((await t.call("ana", "GET", `/files/${sid}/${pdf.id}/tags`)).data as string[]).includes("penting"));
    assert.equal(((await t.call("ana", "GET", `/files/${sid}/${txt.id}/tags`)).data as string[]).length, 0, "the text file does not match");
    const starred = (await t.call("ana", "GET", `/search?starred=true&storageId=${sid}`)).data.items as any[]; assert.ok(starred.some((f) => f.name === "kontrak.pdf") && !starred.some((f) => f.name === "catatan.txt"));
    assert.ok(((await t.call("ana", "GET", "/notifications")).data.items as any[]).some((n) => n.message === "Masuk: kontrak.pdf"));
    const runs = (await t.call("ana", "GET", `/automations/${a.data.id}/runs`)).data as any[]; assert.equal(runs[0].status, "OK"); assert.equal(runs[0].acted, 1);
  });

  it("moves a matching file into another folder, and what it moved never starts another rule", async () => {
    const from = await folder("Unduhan"); const to = await folder("Dokumen");
    await make({ name: "Pindahkan PDF", storageId: sid, folderId: from, trigger: { type: "file.created" }, conditions: { ext: ["pdf"] }, actions: [{ type: "move", storageId: sid, folderId: to }] });
    const watcher = await make({ name: "Tandai di Dokumen", storageId: sid, folderId: to, trigger: { type: "file.created" }, actions: [{ type: "tag", tag: "dipindah" }] });
    const f = await upload("laporan.pdf", "isi", from);
    await t.wait(async () => (await names(to)).includes("laporan.pdf"));
    assert.deepEqual(await names(from), []);
    await settle(500);
    const moved = ((await t.call("ana", "GET", `/files?storageId=${sid}&folderId=${to}`)).data.items as any[])[0];
    assert.equal(((await t.call("ana", "GET", `/files/${sid}/${moved.id}/tags`)).data as string[]).length, 0, "the move did not trigger the watcher: no loop"); void f;
    // a file put in the watched folder by a person does count
    const by = await upload("tangan.txt", "x", to);
    await t.wait(async () => ((await t.call("ana", "GET", `/files/${sid}/${by.id}/tags`)).data as string[]).includes("dipindah"));
    assert.equal(watcher.status, 201);
  });
});

describe("scheduled work", () => {
  it("cleans up old files only, and a preview changes nothing", async () => {
    const tmp = await folder("Sementara"); const old = Date.now() - 100 * 86_400_000;
    await upload("lama.txt", "old", tmp, old); await upload("baru.txt", "new", tmp);
    const a = await make({ name: "Bersihkan", storageId: sid, folderId: tmp, trigger: { type: "schedule", every: "daily", at: "03:00" }, conditions: { olderThanDays: 30 }, actions: [{ type: "trash" }] });
    assert.equal(a.status, 201, JSON.stringify(a.body)); assert.ok(a.data.nextRunAt, "a schedule has a next time");
    const dry = await t.call("ana", "POST", `/automations/${a.data.id}/run`, { dryRun: true });
    assert.equal(dry.data.matched, 1); assert.match(dry.data.message, /lama\.txt/); assert.deepEqual(await names(tmp), ["baru.txt", "lama.txt"], "a preview does nothing");
    const real = await t.call("ana", "POST", `/automations/${a.data.id}/run`, {}); assert.equal(real.data.status, "OK"); assert.equal(real.data.acted, 1);
    assert.deepEqual(await names(tmp), ["baru.txt"]); assert.ok((await trashed()).some((i: any) => i.name === "lama.txt"), "it went to the trash, not away for good");
  });

  it("keeps a folder copied to another (copy what is missing, skip what is there)", async () => {
    const src = await folder("Sumber"); const dst = await folder("Cadangan");
    await upload("a.txt", "a", src); const sub = await folder("Album", src); await upload("b.txt", "b", sub);
    const a = await make({ name: "Cadangan malam", storageId: sid, folderId: src, trigger: { type: "schedule", every: "daily", at: "02:00" }, actions: [{ type: "copy", storageId: sid, folderId: dst, mirror: true }] });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal((await t.call("ana", "POST", `/automations/${a.data.id}/run`, {})).data.acted, 2);
    await t.wait(async () => (await names(dst)).includes("a.txt") && (await names(dst)).includes("Album"));
    await upload("c.txt", "c", src); await t.wait(async () => ((await t.call("ana", "GET", "/transfers")).data.items as any[]).every((j) => !["QUEUED", "RUNNING", "VALIDATING"].includes(j.status)));
    await t.call("ana", "POST", `/automations/${a.data.id}/run`, {});
    await t.wait(async () => (await names(dst)).includes("c.txt"));
    assert.deepEqual(await names(src), ["Album", "a.txt", "c.txt"], "the original stays");
  });

  it("runs by itself when its time has come", async () => {
    const dir = await folder("Jadwal"); const a = await make({ name: "Tiap menit", storageId: sid, folderId: dir, trigger: { type: "schedule", every: "minutes", n: 5 }, actions: [{ type: "notify", message: "tick" }] });
    const { db } = await import("../db.ts"); db.run("UPDATE automations SET next_run_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), a.data.id);
    const { runDueAutomations } = await import("../modules/automations.ts"); await runDueAutomations();
    await t.wait(async () => ((await t.call("ana", "GET", `/automations/${a.data.id}/runs`)).data as any[]).some((r) => r.trigger === "schedule"));
    const after = db.get<{ next_run_at: string }>("SELECT next_run_at FROM automations WHERE id = ?", a.data.id)!.next_run_at; assert.ok(after > new Date().toISOString(), "the next time moved ahead");
  });
});

describe("webhooks and permissions", () => {
  it("posts a signed webhook for a new file", async () => {
    const dir = await folder("Hook"); hooks.length = 0;
    const a = await make({ name: "Kabari", storageId: sid, folderId: dir, trigger: { type: "file.created" }, actions: [{ type: "webhook", url: hookUrl, secret: "rahasia" }] });
    assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.data.actions[0].secret, "••••••••", "the secret is never sent back");
    await upload("baru.txt", "x", dir); await t.wait(() => hooks.length > 0);
    const h = hooks[0]!; assert.equal(h.event, "file.created"); assert.equal(h.body.file.name, "baru.txt"); assert.equal(h.body.automation.name, "Kabari");
    assert.equal(h.sig, `sha256=${crypto.createHmac("sha256", "rahasia").update(JSON.stringify(h.body)).digest("hex")}`);
  });

  it("tells an admin when a transfer fails or a share is opened (event triggers)", async () => {
    hooks.length = 0;
    const a = await make({ name: "Transfer", trigger: { type: "event", event: "transfer.completed" }, actions: [{ type: "webhook", url: hookUrl }] });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const src = await folder("Asal"); const dst = await folder("Tujuan"); const f = await upload("x.txt", "x", src);
    await t.call("ana", "POST", "/transfers", { type: "COPY", source: { storageId: sid, fileIds: [f.id] }, destination: { storageId: sid, folderId: dst } });
    await t.wait(() => hooks.some((h) => h.event === "transfer.completed"));
  });

  it("limits a member to what they could do by hand", async () => {
    const { assertAllowed } = await import("../modules/automations.ts");
    const member = { userId: "m1", userName: "M", isSuperAdmin: false, workspaceId: ws, role: "MEMBER" as const, ip: "" };
    const base = { name: "x", enabled: true, storageId: sid, folderId: null, recursive: true, conditions: {} };
    await assert.rejects(() => assertAllowed(member, { ...base, trigger: { type: "file.created" }, actions: [{ type: "trash" }] }), /izin menghapus/, "a member cannot delete by hand, so not by automation");
    await assert.rejects(() => assertAllowed(member, { ...base, trigger: { type: "file.created" }, actions: [{ type: "webhook", url: hookUrl }] }), /admin/);
    await assert.rejects(() => assertAllowed(member, { ...base, storageId: null, trigger: { type: "event", event: "share.opened" }, actions: [{ type: "notify" }] }), /admin/);
    await assertAllowed(member, { ...base, trigger: { type: "file.created" }, actions: [{ type: "tag", tag: "ok" }, { type: "copy", storageId: sid, folderId: "root" }] });
  });

  it("refuses combinations that make no sense", async () => {
    const dir = await folder("Aneh");
    const bad = (actions: any[], trigger: any = { type: "file.created" }) => make({ name: "x", storageId: sid, folderId: dir, trigger, actions });
    assert.equal((await bad([{ type: "trash" }, { type: "star" }])).status, 400, "move and delete must be last");
    assert.equal((await bad([{ type: "trash" }, { type: "move", storageId: sid, folderId: dir }])).status, 400);
    assert.equal((await bad([{ type: "copy", storageId: sid, folderId: dir, mirror: true }])).status, 400, "mirror is for schedules");
    assert.equal((await make({ name: "x", trigger: { type: "event", event: "upload.failed" }, actions: [{ type: "trash" }] })).status, 400, "an event can only notify");
    assert.equal((await make({ name: "x", trigger: { type: "file.created" }, actions: [{ type: "star" }] })).status, 400, "a file rule needs a storage");
    assert.equal((await bad([{ type: "webhook", url: "ftp://x" }])).status, 400);
  });

  it("switches itself off when its destination is gone, and says so", async () => {
    const from = await folder("Dari"); const to = await folder("Ke");
    const a = await make({ name: "Rusak", storageId: sid, folderId: from, trigger: { type: "file.created" }, actions: [{ type: "copy", storageId: sid, folderId: to }] });
    await t.call("ana", "DELETE", `/files/${sid}/${to}`);
    const run = await t.call("ana", "POST", `/automations/${a.data.id}/run`, {}); assert.equal(run.data.status, "DENIED");
    const list = (await t.call("ana", "GET", "/automations")).data as any[]; assert.equal(list.find((x) => x.id === a.data.id).enabled, false);
    assert.ok(((await t.call("ana", "GET", "/notifications")).data.items as any[]).some((n) => n.type === "automation.disabled"));
    assert.equal((await t.call("ana", "PATCH", `/automations/${a.data.id}/enabled`, { enabled: true })).status >= 400, true, "it cannot be turned on again while it is broken");
  });

  it("can be edited and deleted by its owner", async () => {
    const dir = await folder("Ubah"); const a = await make({ name: "Awal", storageId: sid, folderId: dir, trigger: { type: "file.created" }, actions: [{ type: "star" }] });
    const put = await t.call("ana", "PUT", `/automations/${a.data.id}`, { name: "Akhir", enabled: true, storageId: sid, folderId: dir, recursive: false, trigger: { type: "file.created" }, conditions: { name: "laporan" }, actions: [{ type: "tag", tag: "x" }] });
    assert.equal(put.data.name, "Akhir"); assert.equal(put.data.recursive, false);
    assert.equal((await t.call("ana", "DELETE", `/automations/${a.data.id}`)).status, 200); assert.equal((await t.call("ana", "GET", `/automations/${a.data.id}/runs`)).status, 404);
  });
});
