import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { v2 as dav } from "webdav-server";
import { bootstrap } from "./helpers.ts";
import type { StorageProvider } from "../providers/types.ts";

/**
 * Contract suite for the external-storage adapters. WebDAV runs everywhere (in-process server).
 * SFTP and SMB need real servers, so they run only when SD_TEST_SFTP / SD_TEST_SMB are set:
 *   SD_TEST_SFTP=host:port:user:pass:baseDir      SD_TEST_SMB=host:port:user:pass:share
 */
let t: Awaited<ReturnType<typeof bootstrap>>;
let davServer: dav.WebDAVServer; let davDir: string; let davPort = 0;

before(async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "true";
  t = await bootstrap();
  davDir = fs.mkdtempSync(path.join(t.dir, "dav-"));
  const um = new dav.SimpleUserManager(); um.addUser("alice", "s3cret", false);
  davServer = new dav.WebDAVServer({ port: 18000 + Math.floor(Math.random() * 1000), hostname: "127.0.0.1", httpAuthentication: new dav.HTTPBasicAuthentication(um, "t") });
  davServer.setFileSystem("/", new dav.PhysicalFileSystem(davDir), () => {});
  await new Promise<void>((res) => davServer.start((s: any) => { davPort = s.address().port; res(); }));
  await t.register("ext");
});
after(async () => { await new Promise<void>((r) => davServer?.stop(() => r())); await t.engine.stop(); await t.app.close(); });

const md5 = (b: Buffer) => crypto.createHash("md5").update(b).digest("hex");
async function bytes(s: Readable) { const c: Buffer[] = []; for await (const d of s) c.push(d as Buffer); return Buffer.concat(c); }

function contract(label: string, make: () => Promise<StorageProvider>, enabled: boolean) {
  describe(`${label} adapter contract`, { skip: !enabled && "server not configured" }, () => {
    let p: StorageProvider; const data = crypto.randomBytes(3_000_001); let fileId = ""; let dirId = "";
    before(async () => { p = await make(); });
    after(() => p.close?.());

    it("connects and reports the account", async () => { const a = await p.account(); assert.ok(a.id); });
    it("creates folders (conflict on duplicates) and lists folders first", async () => {
      const d = await p.createFolder("root", "Dir Satu"); dirId = d.id; assert.equal(d.isFolder, true);
      await assert.rejects(() => p.createFolder("root", "Dir Satu"), (e: any) => e.kind === "conflict");
      await p.write({ parentId: "root", name: "zzz.txt", size: 3, stream: Readable.from([Buffer.from("zzz")]) });
      const l = await p.list("root"); assert.equal(l.items[0]!.name, "Dir Satu"); assert.ok(l.items.some((i) => i.name === "zzz.txt"));
    });
    it("round-trips a 3 MB file with spaces and unicode in its name, byte-identical", async () => {
      const f = await p.write({ parentId: dirId, name: "Laporan é 2026.bin", size: data.length, mimeType: "application/octet-stream", stream: Readable.from((function* () { for (let o = 0; o < data.length; o += 65536) yield data.subarray(o, o + 65536); })()) });
      fileId = f.id; assert.equal(f.size, data.length); assert.equal(f.name, "Laporan é 2026.bin");
      const r = await p.read(fileId); assert.equal(md5(await bytes(r.stream)), md5(data));
      assert.ok(!(await p.list(dirId)).items.some((i) => i.name.endsWith(".sdpart")), "no temp files visible");
    });
    it("serves byte ranges", async () => {
      const r = await p.read(fileId, { range: { start: 1_000_000, end: 1_000_999 } });
      assert.deepEqual(r.range, { start: 1_000_000, end: 1_000_999, total: data.length });
      assert.deepEqual(await bytes(r.stream), data.subarray(1_000_000, 1_001_000));
      const tail = await p.read(fileId, { range: { start: data.length - 10 } }); assert.deepEqual(await bytes(tail.stream), data.subarray(data.length - 10));
    });
    it("finds children, maps missing paths to not_found, and reports ancestors", async () => {
      assert.ok(await p.findChild!(dirId, "Laporan é 2026.bin")); assert.equal(await p.findChild!(dirId, "nope"), null);
      await assert.rejects(() => p.stat("tidak/ada.txt"), (e: any) => e.kind === "not_found");
      assert.deepEqual((await p.path!(fileId)).map((x) => x.name), ["Dir Satu", "Laporan é 2026.bin"]);
    });
    it("renames, moves, and deletes into a hidden trash (nothing destroyed, nothing listed)", async () => {
      const r = await p.rename(fileId, "baru.bin"); assert.equal(r.name, "baru.bin");
      const sub = await p.createFolder("root", "Tujuan"); const m = await p.move!(r.id, sub.id); assert.equal(m.parentId, sub.id);
      const zzz = (await p.findChild!("root", "zzz.txt"))!;
      await p.write({ parentId: sub.id, name: "dup.txt", size: 1, stream: Readable.from([Buffer.from("d")]) });
      await assert.rejects(() => p.move!(zzz.id, sub.id, "dup.txt"), (e: any) => e.kind === "conflict");
      await p.delete((await p.findChild!(sub.id, "dup.txt"))!.id);
      await p.delete(m.id);
      assert.ok(!(await p.list(sub.id)).items.length); assert.ok(!(await p.list("root")).items.some((i) => i.name.startsWith(".superdrive")));
    });
    it("rejects path traversal and invalid names", async () => {
      await assert.rejects(() => p.stat("../etc/passwd")); await assert.rejects(() => p.createFolder("root", "a/b"));
    });
  });
}

const davProvider = async () => {
  const { WebdavProvider } = await import("../providers/webdav.ts");
  return new WebdavProvider({ url: `http://127.0.0.1:${davPort}/` }, { username: "alice", password: "s3cret" }, "DAV");
};
contract("WebDAV", davProvider, true);

const sftp = process.env.SD_TEST_SFTP?.split(":");
contract("SFTP", async () => {
  const { SftpProvider } = await import("../providers/sftp.ts");
  return new SftpProvider({ host: sftp![0]!, port: +sftp![1]!, username: sftp![2]!, baseDir: sftp![4]! }, { password: sftp![3] }, () => {}, "SFTP");
}, !!sftp);
const smb = process.env.SD_TEST_SMB?.split(":");
contract("SMB", async () => {
  const { SmbProvider } = await import("../providers/smb.ts");
  return new SmbProvider({ host: smb![0]!, port: +smb![1]!, share: smb![4]! }, { username: smb![2]!, password: smb![3]! }, "SMB");
}, !!smb);

describe("external storages through the API", () => {
  it("rejects wrong WebDAV credentials with a clear message and stores nothing", async () => {
    const r = await t.call("ext", "POST", "/storages", { provider: "WEBDAV", name: "Bad", url: `http://127.0.0.1:${davPort}/`, username: "alice", password: "wrong" });
    assert.equal(r.status, 409); assert.match(r.body.error.message, /Login WebDAV ditolak/);
    assert.equal((await t.call("ext", "GET", "/storages")).data.filter((s: any) => !s.isDefault).length, 0);
  });
  it("copies local → WebDAV → local through the transfer engine with verification", async () => {
    const local = (await t.call("ext", "POST", "/storages", { provider: "LOCAL", name: "L", root: "l" })).data;
    const remote = await t.call("ext", "POST", "/storages", { provider: "WEBDAV", name: "Awan DAV", url: `http://127.0.0.1:${davPort}/`, username: "alice", password: "s3cret" });
    assert.equal(remote.status, 200, JSON.stringify(remote.body));
    const data = crypto.randomBytes(2_500_000); fs.mkdirSync(path.join(t.root, "l", "Proyek"), { recursive: true });
    fs.writeFileSync(path.join(t.root, "l", "Proyek", "a.bin"), data); fs.writeFileSync(path.join(t.root, "l", "Proyek", "b.txt"), "bbb");
    const proj = (await t.call("ext", "GET", `/files?storageId=${local.id}`)).data.items.find((i: any) => i.name === "Proyek");
    const run = async (src: string, ids: string[], dst: string, folder = "root") => {
      const j = await t.call("ext", "POST", "/transfers", { type: "COPY", source: { storageId: src, fileIds: ids }, destination: { storageId: dst, folderId: folder } });
      await t.wait(async () => ["COMPLETED", "FAILED"].includes((await t.call("ext", "GET", `/transfers/${j.data.id}`)).data.status), 30000);
      return (await t.call("ext", "GET", `/transfers/${j.data.id}`)).data;
    };
    const up = await run(local.id, [proj.id], remote.data.id); assert.equal(up.status, "COMPLETED", JSON.stringify(up));
    assert.deepEqual(fs.readFileSync(path.join(davDir, "Proyek", "a.bin")), data);
    const back = (await t.call("ext", "GET", `/files?storageId=${remote.data.id}`)).data.items.find((i: any) => i.name === "Proyek");
    const down = await run(remote.data.id, [back.id], local.id); assert.equal(down.status, "COMPLETED");
    assert.deepEqual(fs.readFileSync(path.join(t.root, "l", "Proyek (2)", "a.bin")), data, "round trip is byte-identical");
    // Browser-facing endpoints work on it too: ranged download.
    const f = (await t.call("ext", "GET", `/files?storageId=${remote.data.id}&folderId=${back.id}`)).data.items.find((i: any) => i.name === "a.bin");
    const part = await t.call("ext", "GET", `/files/${remote.data.id}/${f.id}/download`, undefined, { range: "bytes=10-19" });
    assert.equal(part.status, 206); assert.deepEqual(part.res.rawPayload, data.subarray(10, 20));
  });
});

function viaApi(label: string, body: Record<string, unknown> | null, wrong: Record<string, unknown> | null, checkRoot: (name: string) => boolean, writeSrc: (rel: string, data: Buffer) => void) {
  describe(`${label} through the API`, { skip: !body && "server not configured" }, () => {
    it("rejects bad credentials, then connects, then round-trips files via the transfer engine", async () => {
      const bad = await t.call("ext", "POST", "/storages", wrong!);
      assert.ok([409, 400].includes(bad.status), `bad creds -> ${bad.status} ${JSON.stringify(bad.body)}`);
      const s = await t.call("ext", "POST", "/storages", body!); assert.equal(s.status, 200, JSON.stringify(s.body));
      assert.equal(s.data.status, "CONNECTED"); assert.ok(s.data.mount.virtualPath.startsWith("/storage/"));
      if (label === "SFTP") assert.match(s.data.info, /^Sidik jari host: SHA256:/, "host key pinned on first use");
      const local = (await t.call("ext", "POST", "/storages", { provider: "LOCAL", name: `L-${label}`, root: `l-${label}` })).data;
      const data = crypto.randomBytes(1_500_000); fs.mkdirSync(path.join(t.root, `l-${label}`, "Bundel"), { recursive: true });
      fs.writeFileSync(path.join(t.root, `l-${label}`, "Bundel", "x.bin"), data); fs.writeFileSync(path.join(t.root, `l-${label}`, "Bundel", "n.txt"), "n");
      const b = (await t.call("ext", "GET", `/files?storageId=${local.id}`)).data.items.find((i: any) => i.name === "Bundel");
      const run = async (type: string, src: string, ids: string[], dst: string) => {
        const j = await t.call("ext", "POST", "/transfers", { type, source: { storageId: src, fileIds: ids }, destination: { storageId: dst, folderId: "root" } });
        await t.wait(async () => ["COMPLETED", "FAILED", "COPY_COMPLETED_SOURCE_RETAINED"].includes((await t.call("ext", "GET", `/transfers/${j.data.id}`)).data.status), 40000);
        return (await t.call("ext", "GET", `/transfers/${j.data.id}`)).data;
      };
      assert.equal((await run("COPY", local.id, [b.id], s.data.id)).status, "COMPLETED");
      const remoteList = (await t.call("ext", "GET", `/files?storageId=${s.data.id}`)).data.items; assert.ok(remoteList.some((i: any) => i.name === "Bundel"));
      const rb = remoteList.find((i: any) => i.name === "Bundel");
      // Ranged download + thumbnail-less preview straight from the remote.
      const f = (await t.call("ext", "GET", `/files?storageId=${s.data.id}&folderId=${rb.id}`)).data.items.find((i: any) => i.name === "x.bin");
      const part = await t.call("ext", "GET", `/files/${s.data.id}/${f.id}/download`, undefined, { range: "bytes=100-199" });
      assert.equal(part.status, 206); assert.deepEqual(part.res.rawPayload, data.subarray(100, 200));
      // Move it back (copy + verify + delete source across providers) and compare bytes.
      const back = await run("MOVE", s.data.id, [rb.id], local.id); assert.equal(back.status, "COMPLETED", JSON.stringify(back));
      assert.deepEqual(fs.readFileSync(path.join(t.root, `l-${label}`, "Bundel (2)", "x.bin")), data);
      assert.ok(!(await t.call("ext", "GET", `/files?storageId=${s.data.id}`)).data.items.some((i: any) => i.name === "Bundel"), "source removed after verified move");
      void checkRoot; void writeSrc;
    });
  });
}
viaApi("SFTP", sftp ? { provider: "SFTP", name: "Server SFTP", host: sftp[0], port: +sftp[1]!, username: sftp[2], password: sftp[3], baseDir: sftp[4] } : null,
  sftp ? { provider: "SFTP", name: "Salah", host: sftp[0], port: +sftp[1]!, username: sftp[2], password: "salah", baseDir: sftp[4] } : null, () => true, () => {});
viaApi("SMB", smb ? { provider: "SMB", name: "NAS Kantor", host: smb[0], port: +smb[1]!, username: smb[2], password: smb[3], share: smb[4] } : null,
  smb ? { provider: "SMB", name: "Salah", host: smb[0], port: +smb[1]!, username: smb[2], password: "salah", share: smb[4] } : null, () => true, () => {});

describe("SFTP host key pinning", { skip: !sftp && "server not configured" }, () => {
  it("refuses a connection whose host key does not match the pinned fingerprint", async () => {
    const r = await t.call("ext", "POST", "/storages", { provider: "SFTP", name: "Pin", host: sftp![0], port: +sftp![1]!, username: sftp![2], password: sftp![3], baseDir: sftp![4], hostKey: "SHA256:" + "A".repeat(43) });
    assert.ok(r.status >= 400); assert.match(r.body.error.message, /Kunci host/);
  });
});
