import assert from "node:assert/strict";
import fs from "node:fs";
import type { TelegramApi, TgMessage } from "../providers/telegram.ts";

interface Msg { id: number; text: string; date: number; data: Buffer | null; mime: string | null }

/** An in-memory Telegram channel: enough of the real thing to test the provider without a network. */
export class FakeTelegram implements TelegramApi {
  msgs = new Map<number, Msg>(); private next = 1000; sent = 0; downloads = 0;
  constructor(private maxFile = Infinity) {}
  async me() { return { id: "42", name: "Uji Telegram", username: "uji" }; }
  private view(m: Msg): TgMessage { return { id: m.id, text: m.text, date: m.date, doc: m.data ? { size: m.data.length, mime: m.mime, hasThumb: !!m.mime?.startsWith("image/") } : null }; }
  async after(minId: number, limit: number) { return [...this.msgs.values()].filter((m) => m.id > minId).sort((a, b) => a.id - b.id).slice(0, limit).map((m) => this.view(m)); }
  async sendText(text: string) { const m: Msg = { id: this.next++, text, date: Math.floor(Date.now() / 1000), data: null, mime: null }; this.msgs.set(m.id, m); return this.view(m); }
  async sendFile(f: { path: string; name: string; size: number; mime: string | null }, caption: string) {
    const data = fs.readFileSync(f.path); assert.equal(data.length, f.size, "the file given to Telegram is the size it says");
    if (data.length > this.maxFile) throw new Error("FILE_TOO_LARGE_FOR_THE_FAKE");
    const m: Msg = { id: this.next++, text: caption, date: Math.floor(Date.now() / 1000), data, mime: f.mime }; this.msgs.set(m.id, m); this.sent++; return this.view(m);
  }
  async edit(id: number, text: string) { const m = this.msgs.get(id); assert.ok(m, "edit of an existing message"); m.text = text; }
  async remove(ids: number[]) { for (const id of ids) this.msgs.delete(id); }
  async *download(id: number, start: number, end: number) {
    this.downloads++; const d = this.msgs.get(id)?.data; assert.ok(d, "download of a message with a document"); assert.ok(end <= d.length && start < end);
    for (let o = start; o < end; o += 65536) yield d.subarray(o, Math.min(end, o + 65536));
  }
  async thumbnail(id: number) { const m = this.msgs.get(id); return m?.data && m.mime?.startsWith("image/") ? Buffer.from("fake-jpeg") : null; }
}
