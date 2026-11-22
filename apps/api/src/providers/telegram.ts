import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import mime from "mime-types";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { newId } from "../lib/crypto.ts";
import { baseCaps, ProviderError, ROOT, type AccountInfo, type ListResult, type ReadOptions, type ReadResult, type RemoteFile, type StorageProvider, type ThumbResult, type WriteInput } from "./types.ts";

/**
 * Telegram as storage, using a private channel (or Saved Messages) as the disk.
 *
 * Telegram has no folders and no renaming, so every file is a message whose caption says where it belongs:
 *   SD1 {"n":"name","p":"<parent message id or root>","s":size,...}      a file (a document) or a folder (a text message with "f":1)
 *   SD1P {"of":<first message id>,"i":2}                                  a later piece of a file too big for one message
 * The channel itself is the source of truth. `telegram_items` is a copy for speed and can be rebuilt from it at any time.
 * Renaming and moving only edit a caption, so they are instant and never re-upload anything.
 */

/** Telegram's limit is 2000 MiB per file for ordinary accounts; a little below that leaves a margin. */
export const TG_PART_SIZE = 2_000_000_000;
const TAG = "SD1 "; const TAG_PART = "SD1P ";
const CAPTION_MAX = 1000; // Telegram allows 1024 characters on a caption

/** What the provider needs from Telegram. The real one speaks MTProto (telegramClient.ts); tests use an in-memory stand-in. */
export interface TgMessage { id: number; text: string; date: number; doc: { size: number; mime: string | null; hasThumb: boolean } | null }
export interface TelegramApi {
  me(): Promise<{ id: string; name: string; username: string | null }>;
  /** Messages with an id above `minId`, oldest first, at most `limit`. */
  after(minId: number, limit: number): Promise<TgMessage[]>;
  sendText(text: string): Promise<TgMessage>;
  sendFile(file: { path: string; name: string; size: number; mime: string | null }, caption: string): Promise<TgMessage>;
  /** Changes a message's text, or a document's caption. */
  edit(id: number, text: string): Promise<void>;
  remove(ids: number[]): Promise<void>;
  /** Bytes [start, endExclusive) of a message's document. */
  download(id: number, start: number, endExclusive: number): AsyncIterable<Buffer>;
  thumbnail(id: number): Promise<Buffer | null>;
  close?(): void;
}

interface Meta { n: string; p: string; f?: 1; s?: number; m?: string; t?: string; c?: string; parts?: number[]; ps?: number }
export const encodeCaption = (m: Meta) => {
  const text = TAG + JSON.stringify(m);
  if (text.length > CAPTION_MAX) throw new ProviderError("Nama file terlalu panjang untuk disimpan di Telegram.", "other");
  return text;
};
export function decodeCaption(text: string): Meta | null {
  if (!text.startsWith(TAG)) return null;
  try { const m = JSON.parse(text.slice(TAG.length)); return typeof m?.n === "string" && typeof m?.p === "string" ? (m as Meta) : null; } catch { return null; }
}

interface Row { storage_id: string; msg_id: number; parent: string; name: string; is_folder: number; size: number | null; mime: string | null; mtime: string | null; ctime: string | null; parts: string | null; part_size: number | null; has_thumb: number }
const toRemote = (r: Row): RemoteFile => ({
  id: String(r.msg_id), parentId: r.parent, name: r.name, isFolder: !!r.is_folder, mimeType: r.mime, size: r.is_folder ? null : r.size, modifiedAt: r.mtime, createdAt: r.ctime ?? r.mtime,
  checksum: null, version: `${r.msg_id}:${r.mtime ?? ""}`, hasThumbnail: !!r.has_thumb,
});
const ROOT_FILE: RemoteFile = { id: ROOT, parentId: null, name: "", isFolder: true, mimeType: null, size: null, modifiedAt: null, createdAt: null, checksum: null, version: null, hasThumbnail: false };

/** Names live in captions, so Telegram would take anything; the app still needs names that are safe as file names everywhere. */
function checkName(name: string) {
  if (!name || name === "." || name === ".." || /[\\/\u0000-\u001f]/.test(name) || name.length > 255) throw new ProviderError("Nama tidak valid.", "other");
}

export interface TelegramOptions { partSize: number; syncEveryMs: number; fullEveryMs: number }

export class TelegramProvider implements StorageProvider {
  readonly type = "TELEGRAM" as const;
  readonly capabilities = baseCaps({ rangeRead: true, uploadFile: true, nativeMove: true, nativeThumbnails: true });
  private chain: Promise<unknown> = Promise.resolve();
  private lastSyncAt = 0;
  private opts: TelegramOptions;

  constructor(private api: TelegramApi, private storageId: string, private displayName = "Telegram", opts: Partial<TelegramOptions> = {}) {
    this.opts = { partSize: TG_PART_SIZE, syncEveryMs: 10_000, fullEveryMs: 6 * 3600_000, ...opts };
  }

  async account(): Promise<AccountInfo> {
    const me = await this.api.me();
    return { id: me.id, email: me.username ? `@${me.username}` : null, displayName: me.name, quota: null };
  }

  /* ---- the copy of the tree ---- */

  private serial<T>(fn: () => Promise<T>): Promise<T> { const r = this.chain.then(fn, fn); this.chain = r.catch(() => {}); return r; }

  /** Brings the copy up to date: new messages every few seconds, and a full re-read now and then (it also notices what was deleted elsewhere). */
  private async refresh(force = false) {
    if (!force && Date.now() - this.lastSyncAt < this.opts.syncEveryMs) return;
    await this.serial(async () => {
      if (!force && Date.now() - this.lastSyncAt < this.opts.syncEveryMs) return;
      const st = db.get<{ last_id: number; full_at: string | null }>("SELECT last_id, full_at FROM telegram_sync WHERE storage_id = ?", this.storageId);
      const full = force || !st?.full_at || Date.now() - Date.parse(st.full_at) > this.opts.fullEveryMs;
      await this.pull(full ? 0 : st!.last_id, full, st?.last_id ?? 0);
      this.lastSyncAt = Date.now();
    });
  }

  private async pull(from: number, full: boolean, prevLast: number) {
    const stamp = `${Date.now()}-${Math.random()}`; let last = from;
    for (;;) {
      const batch = await this.api.after(last, 100);
      for (const m of batch) { last = Math.max(last, m.id); this.ingest(m, stamp); }
      if (batch.length < 100) break;
    }
    if (full) db.run("DELETE FROM telegram_items WHERE storage_id = ? AND seen_at IS NOT ?", this.storageId, stamp);
    db.run("INSERT INTO telegram_sync(storage_id, last_id, full_at) VALUES (?,?,?) ON CONFLICT(storage_id) DO UPDATE SET last_id = ?, full_at = COALESCE(?, full_at)",
      this.storageId, Math.max(prevLast, last), full ? now() : null, Math.max(prevLast, last), full ? now() : null);
  }

  private ingest(m: TgMessage, stamp: string) {
    const meta = decodeCaption(m.text); if (!meta) return; // someone else's message, or the later piece of a big file
    const iso = new Date(m.date * 1000).toISOString();
    this.put({
      storage_id: this.storageId, msg_id: m.id, parent: meta.p, name: meta.n, is_folder: meta.f ? 1 : 0, size: meta.f ? null : meta.s ?? m.doc?.size ?? 0, mime: meta.f ? null : meta.m ?? m.doc?.mime ?? null,
      mtime: meta.t ?? iso, ctime: meta.c ?? meta.t ?? iso, parts: meta.parts ? JSON.stringify(meta.parts) : null, part_size: meta.ps ?? null, has_thumb: m.doc?.hasThumb ? 1 : 0,
    }, stamp);
  }

  private put(r: Row, stamp: string | null = null) {
    db.run("INSERT OR REPLACE INTO telegram_items(storage_id,msg_id,parent,name,is_folder,size,mime,mtime,ctime,parts,part_size,has_thumb,seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      r.storage_id, r.msg_id, r.parent, r.name, r.is_folder, r.size, r.mime, r.mtime, r.ctime, r.parts, r.part_size, r.has_thumb, stamp);
  }

  private row(id: string): Row | undefined { return db.get<Row>("SELECT * FROM telegram_items WHERE storage_id = ? AND msg_id = ?", this.storageId, Number(id)); }
  private async need(id: string): Promise<Row> {
    let r = Number.isInteger(Number(id)) ? this.row(id) : undefined;
    if (!r) { await this.refresh(true); r = Number.isInteger(Number(id)) ? this.row(id) : undefined; }
    if (!r) throw new ProviderError("File atau folder tidak ditemukan di Telegram.", "not_found");
    return r;
  }
  private async needFolder(id: string): Promise<void> {
    if (id === ROOT) return;
    const r = await this.need(id);
    if (!r.is_folder) throw new ProviderError("Tujuan bukan folder.", "other");
  }
  private metaOf(r: Row, over: Partial<Meta> = {}): Meta {
    const m: Meta = { n: r.name, p: r.parent };
    if (r.is_folder) m.f = 1; else { m.s = r.size ?? 0; if (r.mime) m.m = r.mime; }
    if (r.mtime) m.t = r.mtime; if (r.ctime) m.c = r.ctime;
    if (r.parts) { m.parts = JSON.parse(r.parts); if (r.part_size) m.ps = r.part_size; }
    return { ...m, ...over };
  }

  /* ---- reading the tree ---- */

  async list(parentId: string, opts: { pageToken?: string | null; limit?: number } = {}): Promise<ListResult> {
    await this.refresh();
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000); const offset = Number(opts.pageToken ?? 0) || 0;
    const rows = db.all<Row>("SELECT * FROM telegram_items WHERE storage_id = ? AND parent = ? ORDER BY is_folder DESC, name COLLATE NOCASE LIMIT ? OFFSET ?", this.storageId, parentId, limit + 1, offset);
    const more = rows.length > limit;
    return { items: (more ? rows.slice(0, limit) : rows).map(toRemote), nextPageToken: more ? String(offset + limit) : null };
  }

  async stat(id: string): Promise<RemoteFile> { return id === ROOT ? ROOT_FILE : toRemote(await this.need(id)); }

  async path(id: string): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = []; let cur = id;
    for (let i = 0; cur !== ROOT && i < 64; i++) { const r = await this.need(cur); out.unshift({ id: String(r.msg_id), name: r.name }); cur = r.parent; }
    return out;
  }

  async findChild(parentId: string, name: string): Promise<RemoteFile | null> {
    await this.refresh();
    const r = db.get<Row>("SELECT * FROM telegram_items WHERE storage_id = ? AND parent = ? AND name = ?", this.storageId, parentId, name);
    return r ? toRemote(r) : null;
  }

  /* ---- changing the tree ---- */

  private async noClash(parentId: string, name: string, except?: string) {
    const hit = await this.findChild(parentId, name);
    if (hit && hit.id !== except) throw new ProviderError(`“${name}” sudah ada di folder tujuan.`, "conflict");
  }

  async createFolder(parentId: string, name: string, _system = false): Promise<RemoteFile> {
    checkName(name); await this.needFolder(parentId); await this.noClash(parentId, name);
    const iso = now();
    const m = await this.api.sendText(encodeCaption({ n: name, p: parentId, f: 1, t: iso, c: iso }));
    const row: Row = { storage_id: this.storageId, msg_id: m.id, parent: parentId, name, is_folder: 1, size: null, mime: null, mtime: iso, ctime: iso, parts: null, part_size: null, has_thumb: 0 };
    this.put(row); return toRemote(row);
  }

  async rename(id: string, name: string): Promise<RemoteFile> {
    checkName(name); const r = await this.need(id); await this.noClash(r.parent, name, id);
    await this.api.edit(r.msg_id, encodeCaption(this.metaOf(r, { n: name })));
    const next = { ...r, name }; this.put(next); return toRemote(next);
  }

  async move(id: string, destParentId: string, newName?: string): Promise<RemoteFile> {
    const r = await this.need(id); await this.needFolder(destParentId);
    if (r.is_folder) for (let cur = destParentId, i = 0; cur !== ROOT && i < 64; i++) { if (cur === id) throw new ProviderError("Folder tidak bisa dipindahkan ke dalam dirinya sendiri.", "other"); cur = (await this.need(cur)).parent; }
    const name = newName ?? r.name; checkName(name); await this.noClash(destParentId, name, id);
    await this.api.edit(r.msg_id, encodeCaption(this.metaOf(r, { n: name, p: destParentId })));
    const next = { ...r, name, parent: destParentId }; this.put(next); return toRemote(next);
  }

  async delete(id: string): Promise<void> {
    const r = await this.need(id);
    const all = r.is_folder
      ? db.all<Row>("WITH RECURSIVE sub(id) AS (SELECT ? UNION SELECT CAST(c.msg_id AS TEXT) FROM telegram_items c JOIN sub ON c.parent = sub.id WHERE c.storage_id = ? AND c.is_folder = 1) SELECT t.* FROM telegram_items t WHERE t.storage_id = ? AND (t.msg_id = ? OR t.parent IN (SELECT id FROM sub))", String(r.msg_id), this.storageId, this.storageId, r.msg_id)
      : [r];
    const ids = [...new Set(all.flatMap((x) => (x.parts ? (JSON.parse(x.parts) as number[]) : [x.msg_id])))];
    for (let i = 0; i < ids.length; i += 100) await this.api.remove(ids.slice(i, i + 100));
    for (const x of all) db.run("DELETE FROM telegram_items WHERE storage_id = ? AND msg_id = ?", this.storageId, x.msg_id);
  }

  /* ---- the bytes ---- */

  async write(i: WriteInput): Promise<RemoteFile> {
    checkName(i.name); await this.needFolder(i.parentId); await this.noClash(i.parentId, i.name);
    const mimeType = i.mimeType || (mime.lookup(i.name) || null);
    const iso = now(); const PART = this.opts.partSize;
    const dir = path.join(config.stagingDir, `tg-${newId()}`); await fsp.mkdir(dir, { recursive: true });
    const sent: number[] = []; let total = 0; let partNo = 0; const first: { msg: TgMessage | null } = { msg: null };
    let cur: { fh: fsp.FileHandle; file: string; size: number } | null = null;
    // A part is only sent once more data follows (or the stream ends), so it is known whether the file is one piece or several.
    const sendPart = async (multi: boolean) => {
      const c = cur!; cur = null; await c.fh.close();
      const label = multi ? `${i.name}.${String(partNo + 1).padStart(3, "0")}` : i.name;
      const caption = partNo === 0 ? encodeCaption({ n: i.name, p: i.parentId, s: i.size ?? c.size, ...(mimeType ? { m: mimeType } : {}), t: iso, c: iso }) : TAG_PART + JSON.stringify({ of: sent[0], i: partNo + 1 });
      const msg = await this.api.sendFile({ path: c.file, name: label, size: c.size, mime: mimeType }, caption);
      sent.push(msg.id); partNo++; await fsp.rm(c.file, { force: true });
      if (partNo === 1) first.msg = msg;
    };
    try {
      for await (const chunk of i.stream as AsyncIterable<Buffer>) {
        let buf = chunk;
        while (buf.length) {
          if (cur && (cur as { size: number }).size >= PART) await sendPart(true);
          if (!cur) { const file = path.join(dir, `part${partNo}`); cur = { fh: await fsp.open(file, "w"), file, size: 0 }; }
          const c = cur as { fh: fsp.FileHandle; size: number };
          const piece = buf.subarray(0, PART - c.size); await c.fh.write(piece); c.size += piece.length; total += piece.length; buf = buf.subarray(piece.length);
        }
      }
      let msgId: number;
      if (total === 0) {
        // Telegram will not take an empty document: an empty file is just its caption.
        msgId = (await this.api.sendText(encodeCaption({ n: i.name, p: i.parentId, s: 0, ...(mimeType ? { m: mimeType } : {}), t: iso, c: iso }))).id;
      } else {
        await sendPart(partNo > 0); msgId = sent[0]!;
        const multi = sent.length > 1;
        if (multi || (i.size ?? total) !== total) {
          await this.api.edit(msgId, encodeCaption({ n: i.name, p: i.parentId, s: total, ...(mimeType ? { m: mimeType } : {}), t: iso, c: iso, ...(multi ? { parts: sent, ps: PART } : {}) }));
        }
      }
      const row: Row = { storage_id: this.storageId, msg_id: msgId, parent: i.parentId, name: i.name, is_folder: 0, size: total, mime: mimeType, mtime: iso, ctime: iso,
        parts: sent.length > 1 ? JSON.stringify(sent) : null, part_size: sent.length > 1 ? PART : null, has_thumb: first.msg?.doc?.hasThumb ? 1 : 0 };
      this.put(row); return toRemote(row);
    } catch (e) {
      // Do not leave half a file behind in the channel.
      if (sent.length) await this.api.remove(sent).catch(() => {});
      throw e;
    } finally {
      if (cur) await (cur as { fh: fsp.FileHandle }).fh.close().catch(() => {});
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  async read(id: string, opts: ReadOptions = {}): Promise<ReadResult> {
    const r = await this.need(id);
    if (r.is_folder) throw new ProviderError("Folder tidak bisa dibaca sebagai file.", "unsupported");
    const total = r.size ?? 0; const type = r.mime;
    if (total === 0) return { stream: Readable.from([]), size: 0, mimeType: type };
    const start = opts.range?.start ?? 0; const end = Math.min(opts.range?.end ?? total - 1, total - 1);
    if (start > end || start >= total) throw new ProviderError("Rentang byte tidak valid.", "other");
    const parts: number[] = r.parts ? JSON.parse(r.parts) : [r.msg_id]; const ps = r.part_size ?? this.opts.partSize; const api = this.api;
    async function* bytes() {
      for (let k = 0; k < parts.length; k++) {
        const from = k * ps; const to = Math.min(total, from + ps);
        const a = Math.max(start, from); const b = Math.min(end + 1, to);
        if (a >= b) continue;
        for await (const buf of api.download(parts[k]!, a - from, b - from)) yield buf;
      }
    }
    const stream = Readable.from(bytes(), { objectMode: false });
    opts.signal?.addEventListener("abort", () => stream.destroy(), { once: true });
    return { stream, size: end - start + 1, mimeType: type, range: opts.range ? { start, end, total } : undefined };
  }

  async thumbnail(file: RemoteFile, _size: number): Promise<ThumbResult | null> {
    if (!file.hasThumbnail) return null;
    const buf = await this.api.thumbnail(Number(file.id));
    return buf ? { stream: Readable.from([buf]), contentType: "image/jpeg" } : null;
  }

  close() { this.api.close?.(); }
}

