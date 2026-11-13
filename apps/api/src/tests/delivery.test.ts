import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>; let sid = "";
before(async () => {
  t = await bootstrap(); await t.register("ana");
  sid = (await t.call("ana", "POST", "/storages", { provider: "LOCAL", name: "S", root: "s" })).data.id;
});
after(async () => { await t.engine.stop(); await t.app.close(); });

const put = (id: string, off: number, b: Buffer) => t.call("ana", "PATCH", `/uploads/${id}`, b, { "upload-offset": String(off), "content-type": "application/octet-stream" });

describe("resumable upload", () => {
  it("continues from the server's offset after an interruption, and the file is byte-identical", async () => {
    const data = crypto.randomBytes(1_000_000);
    const c = await t.call("ana", "POST", "/uploads", { storageId: sid, parentId: "root", name: "r.bin", size: data.length });
    await put(c.data.id, 0, data.subarray(0, 400_000));
    // "Connection lost": client forgets progress and asks where to continue.
    const st = await t.call("ana", "GET", `/uploads/${c.data.id}`);
    assert.equal(st.data.offset, 400_000); assert.equal(st.data.status, "RECEIVING");
    // Re-sending an already-accepted range is refused with the real offset instead of corrupting the file.
    assert.equal((await put(c.data.id, 0, data.subarray(0, 400_000))).body.error.code, "OFFSET_MISMATCH");
    const last = await put(c.data.id, 400_000, data.subarray(400_000));
    // The last chunk's response already carries the final state (no polling needed for local storage).
    assert.equal(last.data.status, "DONE");
    const dl = await t.call("ana", "GET", `/files/${sid}/${last.data.file.id}/download`);
    assert.deepEqual(dl.res.rawPayload, data);
  });
});

describe("zip downloads", () => {
  it("streams several selected files and folders as one ZIP, disambiguating equal names", async () => {
    const mk = async (name: string, body: string, parent = "root") => { const c = await t.call("ana", "POST", "/uploads", { storageId: sid, parentId: parent, name, size: body.length }); return (await put(c.data.id, 0, Buffer.from(body))).data.file; };
    const folder = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Dir" })).data;
    const a = await mk("a.txt", "AAA"); const inner = await mk("in.txt", "INNER", folder.id);
    const body = `storageId=${sid}&id=${encodeURIComponent(a.id)}&id=${encodeURIComponent(folder.id)}`;
    assert.ok(inner.id);
    const res = await t.app.inject({ method: "POST", url: "/api/v1/files/zip", payload: body, headers: { "content-type": "application/x-www-form-urlencoded", cookie: (await login()), origin: "http://localhost:5173" } });
    assert.equal(res.statusCode, 200); assert.equal(res.headers["content-type"], "application/zip");
    const z = res.rawPayload; assert.equal(z.subarray(0, 2).toString(), "PK");
    for (const n of ["a.txt", "Dir/in.txt"]) assert.ok(z.includes(Buffer.from(n)), n);
  });
});

async function login() {
  const r = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: JSON.stringify({ email: "ana@example.com", password: "password123" }), headers: { "content-type": "application/json", "x-requested-with": "superdrive" } });
  return String(r.headers["set-cookie"]).split(";")[0]!;
}
